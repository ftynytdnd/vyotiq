/**
 * Delta-coalescing tests for `chat.ipc.ts`.
 *
 * Contract pinned here:
 *   - Streaming `agent-text-delta` / `agent-reasoning-delta` events are
 *     batched into persisted rows of at least `PERSIST_DELTA_COALESCE_CHARS`
 *     characters (except the final residual, flushed on `*-end` or run-end).
 *   - Every individual delta is STILL forwarded to the renderer so the
 *     UI stays smooth token-by-token.
 *   - `agent-text-end` / `agent-reasoning-end` force a flush of the
 *     corresponding buffer before the end marker is persisted.
 *   - `agent-text-aborted` drops both buffers (flushes them, then drops
 *     the entry) so the aborted marker lands on a clean transcript.
 *   - The `onDone` / `onError` lifecycle callbacks drain any residual
 *     buffers before forwarding the terminal IPC notice.
 *   - Non-delta events persist verbatim (one row per event).
 *
 * We drive the IPC handler end-to-end by mocking only the external
 * surfaces (AgentV, conversationStore, window) and capturing the
 * `emit`/`onDone`/`onError` deps passed to `startRun`.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ipcMain } from 'electron';
import { IPC, PERSIST_DELTA_COALESCE_CHARS } from '@shared/constants';
import type { TimelineEvent } from '@shared/types/chat';

// Capture the deps `startRun` is invoked with so tests can drive
// `emit` / `onDone` / `onError` synthetically.
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
    // Return a never-resolving promise — real run lifecycle is driven
    // by invoking the captured callbacks directly.
    return new Promise<void>(() => undefined);
  }),
  abortRun: vi.fn(),
  // The supersede path now reads ALL runs for a conversation
  // (audit fix A3) so a future race that leaks more than one run
  // doesn't keep streaming silently after `chat:send` aborts the
  // first match. Tests don't exercise that path; an empty array
  // keeps the IPC handler's "no priorRunIds" fast path.
  findAllActiveRunsForConversation: vi.fn(() => [])
}));

// Mock window so `safeSend` can exercise the renderer-forward path.
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

// Record every appendEvent call so we can assert the persistence shape.
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
  // Surfaced by `chat.ipc.ts` to resolve a run's `workspaceId` from the
  // bound conversation when the renderer didn't supply one. The test
  // hard-codes a stub workspace id so the resolution chain succeeds.
  getConversationMeta: vi.fn(async (id: string) => ({
    id,
    title: 't',
    createdAt: 0,
    updatedAt: 0,
    eventCount: 0,
    workspaceId: 'ws-test'
  })),
  listConversations: vi.fn(async () => [
    { id: 'conv-1', title: 't', createdAt: 0, updatedAt: 0, eventCount: 0, workspaceId: 'ws-test' }
  ]),
  readTranscript: vi.fn(async () => []),
  setLastModel: vi.fn(async () => undefined)
}));

// `chat.ipc.ts` falls back to `getActiveWorkspace()` when neither the
// renderer nor the conversation meta resolves a workspaceId. Keep the
// mock surface tight to the symbols actually imported.
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
    runId: 'run-coalesce-1',
    prompt: 'hello',
    selection: { providerId: 'p', modelId: 'm' },
    permissions: { allowFileWrites: false, allowBash: false, allowWebSearch: false },
    conversationId: 'conv-1'
  };
  await (ipcMain as unknown as MockIpcMain).__invoke(IPC.CHAT_SEND, input);
  if (!capture.emit) throw new Error('startRun did not receive emit()');
}

describe('chat.ipc delta coalescing', () => {
  it('batches many tiny deltas into few persisted rows, all forwarded to renderer', async () => {
    await startFreshRun();
    const emit = capture.emit!;

    const msgId = 'msg-1';
    const deltaCount = 1000;
    for (let i = 0; i < deltaCount; i++) {
      emit({
        kind: 'agent-text-delta',
        id: msgId,
        ts: i,
        delta: 'x'
      });
    }

    // Renderer got every delta, verbatim.
    const rendererDeltas = rendererSends.filter(
      (s) =>
        s.channel === IPC.CHAT_EVENT &&
        (s.args[1] as TimelineEvent).kind === 'agent-text-delta'
    );
    expect(rendererDeltas).toHaveLength(deltaCount);

    // Persisted rows are dramatically fewer. The exact count depends on
    // the threshold; we just assert it compresses meaningfully.
    const persistedDeltas = appended.filter(
      (a) => a.event.kind === 'agent-text-delta'
    );
    expect(persistedDeltas.length).toBeLessThan(deltaCount / 10);
    // Every persisted delta has length >= threshold except possibly the
    // last (residual). We emit no `*-end` here so the tail stays buffered.
    for (const a of persistedDeltas) {
      const e = a.event as Extract<TimelineEvent, { kind: 'agent-text-delta' }>;
      expect(e.delta.length).toBeGreaterThanOrEqual(PERSIST_DELTA_COALESCE_CHARS);
    }
  });

  it('flushes the residual buffer on agent-text-end before persisting the end marker', async () => {
    await startFreshRun();
    const emit = capture.emit!;

    const msgId = 'msg-2';
    // Emit just below the coalesce threshold so nothing has been
    // persisted yet.
    const shortChunk = 'x'.repeat(PERSIST_DELTA_COALESCE_CHARS - 10);
    emit({ kind: 'agent-text-delta', id: msgId, ts: 1, delta: shortChunk });

    expect(
      appended.filter((a) => a.event.kind === 'agent-text-delta')
    ).toHaveLength(0);

    emit({ kind: 'agent-text-end', id: msgId, ts: 2 });

    const persistedKinds = appended.map((a) => a.event.kind);
    // Delta flushed first, then the end marker.
    expect(persistedKinds).toEqual(['agent-text-delta', 'agent-text-end']);
    const flushed = appended[0]!.event as Extract<
      TimelineEvent,
      { kind: 'agent-text-delta' }
    >;
    expect(flushed.delta).toBe(shortChunk);
    expect(flushed.id).toBe(msgId);
  });

  it('drops both buffers on agent-text-aborted (flushes first, then persists marker)', async () => {
    await startFreshRun();
    const emit = capture.emit!;

    const msgId = 'msg-3';
    emit({ kind: 'agent-text-delta', id: msgId, ts: 1, delta: 'partial text' });
    emit({ kind: 'agent-reasoning-delta', id: msgId, ts: 2, delta: 'partial reasoning' });

    emit({ kind: 'agent-text-aborted', id: msgId, ts: 3 });

    const kinds = appended.map((a) => a.event.kind);
    // Two flush rows + the aborted marker. Order matters: the partial
    // deltas land BEFORE the aborted marker so replay sees a clean
    // sequence.
    expect(kinds[kinds.length - 1]).toBe('agent-text-aborted');
    expect(kinds.filter((k) => k === 'agent-text-delta')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'agent-reasoning-delta')).toHaveLength(1);
  });

  it('onDone flushes residual buffers before CHAT_DONE', async () => {
    await startFreshRun();
    const emit = capture.emit!;
    const onDone = capture.onDone!;

    emit({ kind: 'agent-text-delta', id: 'msg-4', ts: 1, delta: 'tail' });
    expect(appended.filter((a) => a.event.kind === 'agent-text-delta')).toHaveLength(0);

    onDone();
    // Give the async drain a tick to resolve.
    await new Promise((r) => setTimeout(r, 0));

    const flushed = appended.filter((a) => a.event.kind === 'agent-text-delta');
    expect(flushed).toHaveLength(1);
    const doneSent = rendererSends.some(
      (s) => s.channel === IPC.CHAT_DONE
    );
    expect(doneSent).toBe(true);
  });

  it('does NOT persist run-status events', async () => {
    await startFreshRun();
    const emit = capture.emit!;
    emit({
      kind: 'run-status',
      id: 'rs-1',
      ts: 1,
      phase: 'connecting',
      label: 'Connecting…'
    });
    expect(appended.filter((a) => a.event.kind === 'run-status')).toHaveLength(0);
    const forwarded = rendererSends.find(
      (s) =>
        s.channel === IPC.CHAT_EVENT &&
        (s.args[1] as TimelineEvent).kind === 'run-status'
    );
    // Run-status is forwarded to the renderer but not persisted.
    expect(forwarded).toBeDefined();
  });

  it('persists non-delta events verbatim (no buffering)', async () => {
    await startFreshRun();
    const emit = capture.emit!;
    emit({
      kind: 'phase',
      id: 'phase-1',
      ts: 1,
      label: 'Delegating 2 sub-tasks'
    });
    const phaseRows = appended.filter((a) => a.event.kind === 'phase');
    expect(phaseRows).toHaveLength(1);
  });
});
