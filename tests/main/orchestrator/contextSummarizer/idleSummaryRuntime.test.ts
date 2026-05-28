/**
 * Idle-mode context summarization runtime tests.
 *
 * Covers concurrency gates and undo boundaries without hitting real
 * provider HTTP — `maybeRunSummarization` is mocked to emit a minimal
 * pending/end pair.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { TimelineEvent } from '@shared/types/chat.js';
import {
  appendEvent,
  createConversation,
  readTranscript
} from '@main/conversations/conversationStore';

vi.mock('@main/settings/settingsStore.js', () => ({
  getSettings: vi.fn(async () => ({
    contextSummary: {
      enabled: true,
      summarizerSelection: { providerId: 'prov-1', modelId: 'm-1' }
    },
    ui: { contextSummaryByWorkspace: {} }
  }))
}));

vi.mock('@main/providers/providerStore.js', () => ({
  listProviders: vi.fn(async () => [{ id: 'prov-1', label: 'Test', models: [] }])
}));

vi.mock('@main/workspace/workspaceState.js', () => ({
  listWorkspaces: vi.fn(async () => ({
    activeId: 'ws-1',
    workspaces: [{ id: 'ws-1', path: '/tmp/ws', label: 'WS', addedAt: 0 }]
  }))
}));

vi.mock('@main/window/safeWebContentsSend.js', () => ({
  safeWebContentsSend: vi.fn()
}));

const maybeRunSummarization = vi.fn(
  async (opts: { emit: (event: TimelineEvent) => void }) => {
    await new Promise<void>((resolve) => {
      (globalThis as unknown as { __releaseIdleSummary?: () => void }).__releaseIdleSummary =
        resolve;
    });
    const summaryId = 'summary-test';
    opts.emit({
      kind: 'context-summary-pending',
      id: 'evt-pending',
      ts: Date.now(),
      summaryId,
      range: { startIdx: 1, endIdx: 2 },
      replacedMessageIds: ['m1']
    });
    opts.emit({
      kind: 'context-summary-end',
      id: 'evt-end',
      ts: Date.now(),
      summaryId
    });
    return { ok: true as const, summaryId };
  }
);

vi.mock('@main/orchestrator/contextSummarizer/index.js', () => ({
  maybeRunSummarization: (...args: unknown[]) => maybeRunSummarization(...args),
  replayCompression: vi.fn(),
  replayOverrideEvents: vi.fn(),
  clearForRun: vi.fn()
}));

import {
  abortIdleSummary,
  abortIdleSummaryByRunId,
  awaitIdleSummary,
  hasIdleSummary,
  triggerIdleSummary,
  undoIdleSummary
} from '@main/orchestrator/contextSummarizer/idleSummaryRuntime';

beforeEach(() => {
  maybeRunSummarization.mockClear();
  delete (globalThis as unknown as { __releaseIdleSummary?: () => void }).__releaseIdleSummary;
});

function releaseIdleSummary(): void {
  (globalThis as unknown as { __releaseIdleSummary?: () => void }).__releaseIdleSummary?.();
}

describe('idleSummaryRuntime', () => {
  it('rejects a second trigger while a summary is in flight', async () => {
    const meta = await createConversation('ws-1');
    await appendEvent(meta.id, {
      kind: 'user-prompt',
      id: 'prompt-1',
      ts: Date.now(),
      content: 'hello'
    });

    const first = await triggerIdleSummary(meta.id, 'idle-run-a');
    expect(first.ok).toBe(true);
    expect(hasIdleSummary(meta.id)).toBe(true);

    const second = await triggerIdleSummary(meta.id, 'idle-run-b');
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.reason).toMatch(/already in flight/i);
    }

    releaseIdleSummary();
    await awaitIdleSummary(meta.id);
    expect(hasIdleSummary(meta.id)).toBe(false);
  });

  it('rejects trigger for an unknown conversation', async () => {
    const result = await triggerIdleSummary('missing-conversation', 'idle-run-x');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/unknown conversation/i);
    }
  });

  it('persists summary events and clears the handle after settlement', async () => {
    const meta = await createConversation('ws-1');
    await appendEvent(meta.id, {
      kind: 'user-prompt',
      id: 'prompt-1',
      ts: Date.now(),
      content: 'summarize me'
    });

    const runId = 'idle-run-settle';
    const triggered = await triggerIdleSummary(meta.id, runId);
    expect(triggered.ok).toBe(true);

    releaseIdleSummary();
    await awaitIdleSummary(meta.id);
    expect(hasIdleSummary(meta.id)).toBe(false);

    const transcript = await readTranscript(meta.id);
    expect(transcript.some((e) => e.kind === 'context-summary-pending')).toBe(true);
    expect(transcript.some((e) => e.kind === 'context-summary-end')).toBe(true);
    expect(maybeRunSummarization).toHaveBeenCalledTimes(1);
  });

  it('abortIdleSummary settles the handle without leaving it registered', async () => {
    const meta = await createConversation('ws-1');
    await appendEvent(meta.id, {
      kind: 'user-prompt',
      id: 'prompt-1',
      ts: Date.now(),
      content: 'abort me'
    });

    maybeRunSummarization.mockImplementationOnce(
      async (opts: { signal: AbortSignal; emit: (e: TimelineEvent) => void }) => {
        await new Promise<void>((resolve, reject) => {
          if (opts.signal.aborted) {
            reject(new DOMException('aborted', 'AbortError'));
            return;
          }
          opts.signal.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
          setTimeout(resolve, 50);
        });
        return { ok: false as const, reason: 'aborted' };
      }
    );

    await triggerIdleSummary(meta.id, 'idle-run-abort');
    expect(hasIdleSummary(meta.id)).toBe(true);
    expect(abortIdleSummary(meta.id)).toBe(true);
    await awaitIdleSummary(meta.id);
    expect(hasIdleSummary(meta.id)).toBe(false);
  });

  it('abortIdleSummaryByRunId aborts by synthetic run id', async () => {
    const meta = await createConversation('ws-1');
    await appendEvent(meta.id, {
      kind: 'user-prompt',
      id: 'prompt-by-run',
      ts: Date.now(),
      content: 'stop via run id'
    });

    maybeRunSummarization.mockImplementationOnce(
      async (opts: { signal: AbortSignal }) => {
        await new Promise<void>((resolve, reject) => {
          if (opts.signal.aborted) {
            reject(new DOMException('aborted', 'AbortError'));
            return;
          }
          opts.signal.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
          setTimeout(resolve, 50);
        });
        return { ok: false as const, reason: 'aborted' };
      }
    );

    const runId = 'idle-summary-test-run-id';
    await triggerIdleSummary(meta.id, runId);
    expect(hasIdleSummary(meta.id)).toBe(true);
    expect(abortIdleSummaryByRunId(runId)).toBe(true);
    await awaitIdleSummary(meta.id);
    expect(hasIdleSummary(meta.id)).toBe(false);
    expect(abortIdleSummaryByRunId('unknown-id')).toBe(false);
  });

  it('undoIdleSummary rejects when a later user-prompt exists', async () => {
    const meta = await createConversation('ws-1');
    await appendEvent(meta.id, {
      kind: 'user-prompt',
      id: 'prompt-1',
      ts: Date.now(),
      content: 'first'
    });

    const runId = 'idle-run-undo';
    const triggered = await triggerIdleSummary(meta.id, runId);
    expect(triggered.ok).toBe(true);
    releaseIdleSummary();
    await awaitIdleSummary(meta.id);

    const summaryId = triggered.ok ? triggered.summaryId : '';
    await appendEvent(meta.id, {
      kind: 'user-prompt',
      id: 'prompt-2',
      ts: Date.now() + 1,
      content: 'second turn'
    });

    const undone = await undoIdleSummary(meta.id, summaryId);
    expect(undone.ok).toBe(false);
  });
});
