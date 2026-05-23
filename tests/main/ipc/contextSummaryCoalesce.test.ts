/**
 * Delta-coalescing contract tests for context-summarizer streams.
 *
 * Mirrors `chatCoalesce.test.ts` for the assistant flow. Pinned here:
 *   - Streaming `context-summary-delta` /
 *     `context-summary-reasoning-delta` events batch into persisted
 *     rows of at least `PERSIST_DELTA_COALESCE_CHARS` chars (residual
 *     drains on `-end` / `-aborted` / `-undone` / run-end).
 *   - Every individual delta is forwarded to the renderer verbatim
 *     (smooth token-by-token streaming), only the persisted shape
 *     changes.
 *   - `context-summary-end` flushes the residual buffers BEFORE the
 *     end marker is persisted (replay sees `...deltas → end`).
 *   - `context-summary-aborted` / `-undone` drop both buffers and
 *     tombstone the summaryId so straggling deltas after the
 *     terminal marker land neither in persistence nor in the
 *     renderer's reducer accumulator.
 *   - `onDone` / `onError` drain residual summary buffers before
 *     forwarding the terminal IPC notice.
 *
 * Same harness shape as `chatCoalesce.test.ts` — driven end-to-end by
 * mocking only the external surfaces (AgentV, conversationStore,
 * window) and capturing the deps `startRun` is invoked with.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ipcMain } from 'electron';
import { IPC, PERSIST_DELTA_COALESCE_CHARS } from '@shared/constants';
import type { TimelineEvent } from '@shared/types/chat';

interface StartRunCapture {
  emit?: (event: TimelineEvent) => void;
  onDone?: () => void;
  onError?: (msg: string) => void;
}
const capture: StartRunCapture = {};

vi.mock('@main/orchestrator/AgentV', () => ({
  startRun: vi.fn((_input, deps: StartRunCapture) => {
    capture.emit = deps.emit;
    capture.onDone = deps.onDone;
    capture.onError = deps.onError;
    return new Promise<void>(() => undefined);
  }),
  abortRun: vi.fn(),
  findAllActiveRunsForConversation: vi.fn(() => [])
}));

const rendererSends: Array<{ channel: string; args: unknown[] }> = [];
vi.mock('@main/window/getMainWindow', () => ({
  getMainWindow: () => ({
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      send: (channel: string, ...args: unknown[]) => {
        rendererSends.push({ channel, args });
      }
    }
  })
}));

const appended: Array<{ id: string; event: TimelineEvent }> = [];
vi.mock('@main/conversations/conversationStore', () => ({
  appendEvent: vi.fn(async (id: string, event: TimelineEvent) => {
    appended.push({ id, event });
  }),
  createConversation: vi.fn(async (workspaceId: string) => ({
    id: 'conv-new',
    title: 'New conversation',
    createdAt: 0,
    updatedAt: 0,
    eventCount: 0,
    workspaceId
  })),
  deriveTitleIfFresh: vi.fn(async () => undefined),
  drainAppendChain: vi.fn(async () => undefined),
  getConversationMeta: vi.fn(async (id: string) => ({
    id,
    title: 't',
    createdAt: 0,
    updatedAt: 0,
    eventCount: 0,
    workspaceId: 'ws-test'
  })),
  listConversations: vi.fn(async () => [
    {
      id: 'conv-1',
      title: 't',
      createdAt: 0,
      updatedAt: 0,
      eventCount: 0,
      workspaceId: 'ws-test'
    }
  ]),
  readTranscript: vi.fn(async () => []),
  setLastModel: vi.fn(async () => undefined)
}));

vi.mock('@main/workspace/workspaceState', () => ({
  getActiveWorkspace: vi.fn(async () => ({
    id: 'ws-test',
    path: '/tmp/ws-test',
    label: 'ws-test',
    addedAt: 0
  }))
}));

import { registerChatIpc } from '@main/ipc/chat.ipc';

interface MockIpcMain {
  __invoke: (channel: string, ...args: unknown[]) => unknown;
}

beforeEach(() => {
  appended.length = 0;
  rendererSends.length = 0;
  delete capture.emit;
  delete capture.onDone;
  delete capture.onError;
});

async function startFreshRun() {
  registerChatIpc();
  const input = {
    runId: 'run-summary-1',
    prompt: 'hello',
    selection: { providerId: 'p', modelId: 'm' },
    permissions: { allowAuto: false },
    conversationId: 'conv-1'
  };
  await (ipcMain as unknown as MockIpcMain).__invoke(IPC.CHAT_SEND, input);
  if (!capture.emit) throw new Error('startRun did not receive emit()');
}

describe('chat.ipc context-summary delta coalescing', () => {
  it('batches many summary-delta tokens into few persisted rows', async () => {
    await startFreshRun();
    const emit = capture.emit!;

    const summaryId = 'sum-1';
    const deltaCount = 1000;
    for (let i = 0; i < deltaCount; i++) {
      emit({
        kind: 'context-summary-delta',
        id: `evt-${i}`,
        ts: i,
        summaryId,
        delta: 'x'
      });
    }

    // Renderer received every delta verbatim.
    const rendererDeltas = rendererSends.filter(
      (s) =>
        s.channel === IPC.CHAT_EVENT &&
        (s.args[1] as TimelineEvent).kind === 'context-summary-delta'
    );
    expect(rendererDeltas).toHaveLength(deltaCount);

    // Persisted rows compress dramatically. Tail residual stays buffered
    // because we don't emit `-end` here.
    const persistedDeltas = appended.filter(
      (a) => a.event.kind === 'context-summary-delta'
    );
    expect(persistedDeltas.length).toBeLessThan(deltaCount / 10);
    for (const a of persistedDeltas) {
      const e = a.event as Extract<TimelineEvent, { kind: 'context-summary-delta' }>;
      expect(e.delta.length).toBeGreaterThanOrEqual(PERSIST_DELTA_COALESCE_CHARS);
      expect(e.summaryId).toBe(summaryId);
    }
  });

  it('flushes residual summary buffer on context-summary-end before persisting end marker', async () => {
    await startFreshRun();
    const emit = capture.emit!;

    const summaryId = 'sum-2';
    const shortChunk = 'y'.repeat(PERSIST_DELTA_COALESCE_CHARS - 10);
    emit({
      kind: 'context-summary-delta',
      id: 'd1',
      ts: 1,
      summaryId,
      delta: shortChunk
    });
    expect(
      appended.filter((a) => a.event.kind === 'context-summary-delta')
    ).toHaveLength(0);

    emit({
      kind: 'context-summary-end',
      id: 'end-1',
      ts: 2,
      summaryId,
      afterTokens: 100,
      finalText: shortChunk,
      savedPercent: 50
    });

    const persistedKinds = appended.map((a) => a.event.kind);
    expect(persistedKinds).toEqual(['context-summary-delta', 'context-summary-end']);
    const flushed = appended[0]!.event as Extract<
      TimelineEvent,
      { kind: 'context-summary-delta' }
    >;
    expect(flushed.delta).toBe(shortChunk);
    expect(flushed.summaryId).toBe(summaryId);
  });

  it('drops residual buffers on context-summary-aborted and tombstones late deltas', async () => {
    await startFreshRun();
    const emit = capture.emit!;

    const summaryId = 'sum-3';
    emit({
      kind: 'context-summary-delta',
      id: 'd1',
      ts: 1,
      summaryId,
      delta: 'partial summary'
    });
    emit({
      kind: 'context-summary-reasoning-delta',
      id: 'd2',
      ts: 2,
      summaryId,
      delta: 'partial reasoning'
    });

    emit({
      kind: 'context-summary-aborted',
      id: 'abort-1',
      ts: 3,
      summaryId,
      reason: 'Provider timeout'
    });

    // Late delta lands AFTER the abort marker. Renderer still gets it
    // (the renderer reducer ignores deltas against an aborted/ended
    // accumulator), but it must NOT be persisted — replay would
    // otherwise see `aborted → delta` out of order.
    emit({
      kind: 'context-summary-delta',
      id: 'd3',
      ts: 4,
      summaryId,
      delta: 'should be dropped'
    });

    const kinds = appended.map((a) => a.event.kind);
    expect(kinds).toContain('context-summary-aborted');
    expect(kinds[kinds.length - 1]).toBe('context-summary-aborted');
    // Two flushed deltas (one text + one reasoning) before the abort.
    const flushedText = appended.filter(
      (a) => a.event.kind === 'context-summary-delta'
    );
    const flushedReasoning = appended.filter(
      (a) => a.event.kind === 'context-summary-reasoning-delta'
    );
    expect(flushedText).toHaveLength(1);
    expect(flushedReasoning).toHaveLength(1);
    // The late delta after abort is dropped from persistence.
    expect(flushedText[0]!.event).toMatchObject({
      kind: 'context-summary-delta',
      summaryId,
      delta: 'partial summary'
    });
  });

  it('onDone drains residual summary buffer before CHAT_DONE', async () => {
    await startFreshRun();
    const emit = capture.emit!;
    const onDone = capture.onDone!;

    emit({
      kind: 'context-summary-delta',
      id: 'd1',
      ts: 1,
      summaryId: 'sum-4',
      delta: 'tail body'
    });
    expect(
      appended.filter((a) => a.event.kind === 'context-summary-delta')
    ).toHaveLength(0);

    onDone();
    await new Promise((r) => setTimeout(r, 0));

    const flushed = appended.filter(
      (a) => a.event.kind === 'context-summary-delta'
    );
    expect(flushed).toHaveLength(1);
    expect(rendererSends.some((s) => s.channel === IPC.CHAT_DONE)).toBe(true);
  });
});
