import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  applyContextCompactionIfEnabled,
  buildCompactionBanner,
  isCompactedToolContent
} from '@main/orchestrator/context/contextCompaction';
import {
  writeCompactionArtifact,
  cleanupCompactionArtifactsForConversation,
  sweepOrphanCompactionArtifacts
} from '@main/orchestrator/context/compactionArtifacts';
import { seedCacheLayeredMessages } from '@main/orchestrator/context/buildContextLayers';
import { WORKSPACE_DOTDIR } from '@shared/constants';
import { resolveAgentBehaviorSettings } from '@shared/settings/agentBehaviorSettings';

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

vi.mock('@main/providers/tokenCounter', () => ({
  tokenizeMessages: vi.fn(() => ({ total: 200_000, exact: true }))
}));

describe('contextCompaction', () => {
  let workspacePath: string;

  beforeEach(async () => {
    workspacePath = await mkdtemp(path.join(os.tmpdir(), 'vyotiq-compact-'));
  });

  afterEach(async () => {
    await rm(workspacePath, { recursive: true, force: true });
  });

  it('passes messages through when compaction is disabled', async () => {
    const messages = seedCacheLayeredMessages([], '<turn/>');
    messages[0] = { role: 'system', content: '<system_instructions>x</system_instructions>' };
    const out = await applyContextCompactionIfEnabled(
      messages,
      {
        conversationId: 'conv-1',
        runId: 'run-1',
        workspacePath,
        modelId: 'gpt-4o',
        providerId: 'openai',
        agentBehavior: resolveAgentBehaviorSettings(),
        emit: () => {}
      },
      { value: false }
    );
    expect(out).toEqual(messages);
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

    const agentBehavior = resolveAgentBehaviorSettings({
      agentBehavior: { contextCompaction: { enabled: true } }
    });

    const emitted: Array<{ kind: string }> = [];
    const out = await applyContextCompactionIfEnabled(
      messages,
      {
        conversationId: 'conv-1',
        runId: 'run-1',
        workspacePath,
        modelId: 'gpt-4o',
        providerId: 'openai',
        agentBehavior,
        emit: (e) => emitted.push(e)
      },
      { value: false }
    );

    const toolMsg = out[3];
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
});
