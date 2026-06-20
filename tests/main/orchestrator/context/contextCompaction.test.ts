import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  buildCompactionBanner,
  createContextReductionState,
  isCompactedToolContent,
  reduceContextIfNeeded
} from '@main/orchestrator/context/contextCompaction';
import {
  writeCompactionArtifact,
  cleanupCompactionArtifactsForConversation,
  cleanupSummaryArtifactsForConversation,
  sweepOrphanCompactionArtifacts,
  sweepOrphanSummaryArtifacts,
  writeSummaryArtifact
} from '@main/orchestrator/context/compactionArtifacts';
import { seedCacheLayeredMessages } from '@main/orchestrator/context/buildContextLayers';
import { WORKSPACE_DOTDIR } from '@shared/constants';
import {
  DEFAULT_CONTEXT_MANAGEMENT_SETTINGS,
  type ContextManagementSettings
} from '@shared/settings/agentBehaviorSettings';

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

function cmSettings(patch: Partial<ContextManagementSettings>): ContextManagementSettings {
  return { ...DEFAULT_CONTEXT_MANAGEMENT_SETTINGS, ...patch };
}

vi.mock('@main/providers/tokenCounter', () => ({
  tokenizeMessages: vi.fn(() => ({
    total: 200_000,
    exact: true,
    visionTokens: 0,
    breakdown: {
      system: 0,
      fewShot: 0,
      workspace: 0,
      history: 200_000,
      runtime: 0,
      turn: 0,
      tools: 0
    }
  }))
}));

vi.mock('@main/providers/providerStore', () => ({
  getProviderWithKey: vi.fn(async () => ({
    id: 'openai',
    name: 'OpenAI',
    models: [{ id: 'gpt-4o', contextWindow: 200_000 }],
    contextOverrides: {}
  }))
}));

import { getProviderWithKey } from '@main/providers/providerStore.js';

const summarizeHistoryMock = vi.fn(async () => ({
  summary: '## Task intent\ncompacted',
  relativePath: '.vyotiq/context-summaries/conv-sum/run-sum/s.txt',
  originalChars: 12_000,
  originalMessages: 8
}));

vi.mock('@main/orchestrator/context/contextSummarize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/orchestrator/context/contextSummarize')>();
  return {
    ...actual,
    summarizeHistory: (...args: unknown[]) => summarizeHistoryMock(...args)
  };
});

describe('contextCompaction', () => {
  let workspacePath: string;

  beforeEach(async () => {
    workspacePath = await mkdtemp(path.join(os.tmpdir(), 'vyotiq-compact-'));
  });

  afterEach(async () => {
    await rm(workspacePath, { recursive: true, force: true });
  });

  it('passes messages through when context management is disabled', async () => {
    const messages = seedCacheLayeredMessages([], '<turn/>');
    messages[0] = { role: 'system', content: '<system_instructions>x</system_instructions>' };
    const out = await reduceContextIfNeeded(
      messages,
      {
        conversationId: 'conv-1',
        runId: 'run-1',
        workspacePath,
        modelId: 'gpt-4o',
        providerId: 'openai',
        settings: cmSettings({ enabled: false }),
        emit: () => {}
      },
      createContextReductionState()
    );
    expect(out.messages).toEqual(messages);
  });

  it('migrates legacy topology before attempting reduction', async () => {
    const legacy = [
      { role: 'system' as const, content: '<system_instructions>x</system_instructions>' },
      { role: 'user' as const, content: '<turn/>' }
    ];

    const out = await reduceContextIfNeeded(
      legacy,
      {
        conversationId: 'conv-legacy',
        runId: 'run-legacy',
        workspacePath,
        modelId: 'gpt-4o',
        providerId: 'openai',
        settings: cmSettings({ enabled: true, summarizationEnabled: false }),
        force: true,
        emit: () => {}
      },
      createContextReductionState()
    );

    expect(out.messages.length).toBeGreaterThanOrEqual(5);
    expect(out.messages[0]?.role).toBe('system');
    expect(out.messages[out.messages.length - 1]?.role).toBe('user');
  });

  it('reduces on 1M-window models at the absolute compaction trigger (~200k)', async () => {
    vi.mocked(getProviderWithKey).mockResolvedValueOnce({
      id: 'deepseek',
      name: 'DeepSeek',
      models: [{ id: 'deepseek-v4-flash', contextWindow: 1_000_000 }],
      contextOverrides: {}
    } as Awaited<ReturnType<typeof getProviderWithKey>>);

    const largeOutput = 'x'.repeat(5_000);
    const messages = seedCacheLayeredMessages([], '<turn/>');
    messages[0] = { role: 'system', content: '<system_instructions>x</system_instructions>' };
    messages.splice(3, 0, {
      role: 'tool',
      tool_call_id: 'tc-1m',
      name: 'read',
      content: largeOutput
    });

    const out = await reduceContextIfNeeded(
      messages,
      {
        conversationId: 'conv-1m',
        runId: 'run-1m',
        workspacePath,
        modelId: 'deepseek-v4-flash',
        providerId: 'deepseek',
        settings: cmSettings({
          enabled: true,
          summarizationEnabled: false,
          keepLastToolResults: 0,
          minSavingsTokens: 0
        }),
        emit: () => {}
      },
      createContextReductionState()
    );

    expect(out.usage.effectiveWindow).toBe(1_000_000);
    expect(out.usage.fractionUsed).toBeCloseTo(0.2, 2);
    expect(out.usage.level).toBe('trigger');
    expect(isCompactedToolContent(String(out.messages[3]?.content))).toBe(true);
  });

  it('replaces large tool outputs with reversible banners when over threshold', async () => {
    const largeOutput = 'x'.repeat(5_000);
    const messages = seedCacheLayeredMessages([], '<turn/>');
    messages[0] = { role: 'system', content: '<system_instructions>x</system_instructions>' };
    messages.splice(3, 0, {
      role: 'tool',
      tool_call_id: 'tc-large',
      name: 'read',
      content: largeOutput
    });

    const emitted: Array<{ kind: string }> = [];
    const out = await reduceContextIfNeeded(
      messages,
      {
        conversationId: 'conv-1',
        runId: 'run-1',
        workspacePath,
        modelId: 'gpt-4o',
        providerId: 'openai',
        // Summarization off so the test exercises the reversible offload tier
        // only (no model round-trip).
        settings: cmSettings({ enabled: true, summarizationEnabled: false }),
        emit: (e) => emitted.push(e)
      },
      createContextReductionState()
    );

    const toolMsg = out.messages[3];
    expect(toolMsg?.role).toBe('tool');
    expect(typeof toolMsg?.content).toBe('string');
    expect(isCompactedToolContent(toolMsg!.content as string)).toBe(true);

    const artifactPath = path.join(
      workspacePath,
      WORKSPACE_DOTDIR,
      'compaction',
      'conv-1',
      'run-1',
      'tc-large.txt'
    );
    await expect(readFile(artifactPath, 'utf8')).resolves.toBe(largeOutput);

    // A persisted `tool-compacted` marker is emitted for replay, plus a
    // single one-time `agent-thought` user notice.
    const marker = emitted.find((e) => e.kind === 'tool-compacted') as
      | { kind: string; toolCallId: string; relativePath: string }
      | undefined;
    expect(marker?.toolCallId).toBe('tc-large');
    expect(marker?.relativePath).toContain('tc-large.txt');
    expect(emitted.filter((e) => e.kind === 'agent-thought')).toHaveLength(1);
  });

  it('clears tool results older than keep-last-N (host-side tool clearing)', async () => {
    const toolRows = Array.from({ length: 5 }, (_, i) => ({
      role: 'tool' as const,
      tool_call_id: `tc-${i}`,
      name: 'read',
      content: 'y'.repeat(1_000)
    }));
    const messages = seedCacheLayeredMessages(toolRows, '<turn/>');
    messages[0] = { role: 'system', content: '<system_instructions>x</system_instructions>' };

    const emitted: Array<{ kind: string; reason?: string }> = [];
    const out = await reduceContextIfNeeded(
      messages,
      {
        conversationId: 'conv-clear',
        runId: 'run-clear',
        workspacePath,
        modelId: 'gpt-4o',
        providerId: 'openai',
        settings: cmSettings({
          enabled: true,
          summarizationEnabled: false,
          keepLastToolResults: 3
        }),
        emit: (e) => emitted.push(e)
      },
      createContextReductionState()
    );

    // 5 tool rows, keep last 3 → the 2 oldest are cleared (reason 'clear');
    // they are below the size threshold so only the keep-N rule applies.
    const cleared = emitted.filter((e) => e.kind === 'tool-compacted');
    expect(cleared).toHaveLength(2);
    expect(cleared.every((e) => e.reason === 'clear')).toBe(true);
    expect(isCompactedToolContent(out.messages[3]!.content as string)).toBe(true);
    expect(isCompactedToolContent(out.messages[4]!.content as string)).toBe(true);
    expect(isCompactedToolContent(out.messages[5]!.content as string)).toBe(false);
    expect(isCompactedToolContent(out.messages[7]!.content as string)).toBe(false);
  });

  it('buildCompactionBanner round-trips detection', () => {
    const banner = buildCompactionBanner('.vyotiq/compaction/c/r/t.txt');
    expect(isCompactedToolContent(banner)).toBe(true);
  });

  it('read restores a written compaction artifact byte-for-byte', async () => {
    const body = 'restore-me-'.repeat(500);
    const rel = await writeCompactionArtifact(
      workspacePath,
      'conv-restore',
      'run-restore',
      'tc-restore',
      body
    );
    const abs = path.join(workspacePath, ...rel.split('/'));
    await expect(readFile(abs, 'utf8')).resolves.toBe(body);
  });

  it('cleanupCompactionArtifactsForConversation removes only that conversation tree', async () => {
    await writeCompactionArtifact(workspacePath, 'conv-A', 'run-1', 'tc', 'a');
    await writeCompactionArtifact(workspacePath, 'conv-B', 'run-1', 'tc', 'b');
    const root = path.join(workspacePath, WORKSPACE_DOTDIR, 'compaction');

    await cleanupCompactionArtifactsForConversation(workspacePath, 'conv-A');

    expect(await exists(path.join(root, 'conv-A'))).toBe(false);
    expect(await exists(path.join(root, 'conv-B'))).toBe(true);
  });

  it('sweepOrphanCompactionArtifacts removes only dirs absent from the live set', async () => {
    await writeCompactionArtifact(workspacePath, 'conv-live', 'run-1', 'tc', 'x');
    await writeCompactionArtifact(workspacePath, 'conv-dead', 'run-1', 'tc', 'y');
    const root = path.join(workspacePath, WORKSPACE_DOTDIR, 'compaction');

    const removed = await sweepOrphanCompactionArtifacts(
      workspacePath,
      new Set(['conv-live'])
    );

    expect(removed).toBe(1);
    expect(await exists(path.join(root, 'conv-live'))).toBe(true);
    expect(await exists(path.join(root, 'conv-dead'))).toBe(false);
  });

  it('writeSummaryArtifact persists the pre-summary transcript', async () => {
    const transcript = 'TURN 1\nTURN 2'.repeat(100);
    const rel = await writeSummaryArtifact(
      workspacePath,
      'conv-sum',
      'run-sum',
      transcript
    );
    expect(rel).toContain('context-summaries');
    const abs = path.join(workspacePath, ...rel.split('/'));
    await expect(readFile(abs, 'utf8')).resolves.toBe(transcript);
  });

  it('escalates to summarization when offloads leave usage in the warn band', async () => {
    summarizeHistoryMock.mockClear();
    const largeOutput = 'x'.repeat(5_000);
    const toolRows = Array.from({ length: 8 }, (_, i) => ({
      role: 'tool' as const,
      tool_call_id: `tc-sum-${i}`,
      name: 'read',
      content: largeOutput
    }));
    const messages = seedCacheLayeredMessages(toolRows, '<turn/>');
    messages[0] = { role: 'system', content: '<system_instructions>x</system_instructions>' };

    const emitted: Array<{ kind: string }> = [];
    await reduceContextIfNeeded(
      messages,
      {
        conversationId: 'conv-sum',
        runId: 'run-sum',
        workspacePath,
        modelId: 'gpt-4o',
        providerId: 'openai',
        settings: cmSettings({ enabled: true, summarizationEnabled: true }),
        emit: (e) => emitted.push(e)
      },
      createContextReductionState()
    );

    expect(summarizeHistoryMock).toHaveBeenCalled();
    expect(emitted.some((e) => e.kind === 'context-summary')).toBe(true);
  });

  it('cleanup + sweep reclaim summary artifacts like compaction artifacts', async () => {
    await writeSummaryArtifact(workspacePath, 'conv-A', 'run-1', 'a');
    await writeSummaryArtifact(workspacePath, 'conv-B', 'run-1', 'b');
    const root = path.join(workspacePath, WORKSPACE_DOTDIR, 'context-summaries');

    await cleanupSummaryArtifactsForConversation(workspacePath, 'conv-A');
    expect(await exists(path.join(root, 'conv-A'))).toBe(false);
    expect(await exists(path.join(root, 'conv-B'))).toBe(true);

    const removed = await sweepOrphanSummaryArtifacts(workspacePath, new Set(['conv-B']));
    expect(removed).toBe(0);
    const removed2 = await sweepOrphanSummaryArtifacts(workspacePath, new Set<string>());
    expect(removed2).toBe(1);
    expect(await exists(path.join(root, 'conv-B'))).toBe(false);
  });
});
