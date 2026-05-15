/**
 * Race-fix guard for `readTranscript` vs. fire-and-forget `appendEvent`.
 *
 * Pre-fix, `chat.ipc.ts:emit` would call `appendEvent(...).catch(...)`
 * without awaiting completion, then a quick follow-up `chat:send` would
 * call `readTranscript` and observe a torn / truncated JSONL — which
 * the orchestrator interpreted as "no prior turns". The fix:
 *
 *   1. `readTranscript` self-drains the per-conversation appendChain
 *      before opening the read stream.
 *   2. `drainAppendChain(id)` is exported so call sites that need a
 *      durability barrier (e.g. firing `CHAT_DONE`) can synchronise.
 *
 * These tests pin both invariants so a future refactor can't regress
 * them silently.
 */

import { describe, expect, it } from 'vitest';
import {
  appendEvent,
  createConversation,
  drainAppendChain,
  readTranscript
} from '@main/conversations/conversationStore';
import type { TimelineEvent } from '@shared/types/chat';

function evt(content: string): TimelineEvent {
  return {
    kind: 'user-prompt',
    id: `e-${Math.random().toString(36).slice(2)}`,
    ts: Date.now(),
    content
  };
}

describe('conversationStore — drainAppendChain', () => {
  it('readTranscript observes ALL fire-and-forget appends, including the tail', async () => {
    const meta = await createConversation('ws-test');

    // Mirror chat.ipc.ts's emitter: fire-and-forget. We do NOT await the
    // returned promises individually. Pre-fix this would race with the
    // immediate `readTranscript` below and the tail event would be
    // missing OR the last line would be torn (skipped as malformed).
    const N = 25;
    const fires: Array<Promise<void>> = [];
    for (let i = 0; i < N; i++) {
      fires.push(appendEvent(meta.id, evt(`fire-${i}`)));
    }
    // IMPORTANT: do NOT await `Promise.all(fires)` here — the whole
    // point of the test is that `readTranscript` synchronises by itself.

    const events = await readTranscript(meta.id);
    expect(events).toHaveLength(N);
    // Order preserved (per-conversation chain is FIFO).
    for (let i = 0; i < N; i++) {
      expect((events[i] as { content: string }).content).toBe(`fire-${i}`);
    }

    // Sanity: awaiting the original promises must still resolve cleanly.
    await Promise.all(fires);
  });

  it('drainAppendChain awaits in-flight appends without surfacing internal errors', async () => {
    const meta = await createConversation('ws-test');

    // Queue several appends without awaiting individually.
    void appendEvent(meta.id, evt('a'));
    void appendEvent(meta.id, evt('b'));
    void appendEvent(meta.id, evt('c'));

    // The drain must resolve even though the caller never `await`ed
    // the individual appendEvent promises.
    await expect(drainAppendChain(meta.id)).resolves.toBeUndefined();

    // After drain, all three events are durably visible.
    const events = await readTranscript(meta.id);
    expect(events).toHaveLength(3);
    expect((events[0] as { content: string }).content).toBe('a');
    expect((events[2] as { content: string }).content).toBe('c');
  });

  it('drainAppendChain on an unknown / quiescent id is a no-op', async () => {
    // No conversation, no prior appends — must not throw.
    await expect(drainAppendChain('nonexistent-id')).resolves.toBeUndefined();
  });
});
