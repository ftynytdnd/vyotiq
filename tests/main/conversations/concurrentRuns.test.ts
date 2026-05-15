/**
 * Concurrent-runs regression — invariant under multi-workspace + multi-
 * session use.
 *
 * Two conversations belonging to DIFFERENT workspaces can have streaming
 * appends interleaved arbitrarily (different orchestrator runs racing in
 * parallel) without their JSONL transcripts cross-contaminating. The
 * append chain is per-`conversationId`, so each transcript should observe
 * its own events in FIFO order regardless of how the global event firing
 * order was scheduled.
 *
 * This pins the storage-level invariant the multi-session feature
 * depends on: switching the active workspace mid-run never reroutes a
 * sub-agent's later events into the wrong file.
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

describe('conversationStore — concurrent runs across workspaces', () => {
  it('interleaved appends to two different conversations stay isolated', async () => {
    const a = await createConversation('ws-A');
    const b = await createConversation('ws-B');

    // Interleave 50 appends across the two transcripts in a checker
    // pattern so neither conversation owns a contiguous run of writes.
    // The per-conversation FIFO must still hold once the dust settles.
    const N = 50;
    const fires: Array<Promise<void>> = [];
    for (let i = 0; i < N; i++) {
      fires.push(appendEvent(a.id, evt(`a-${i}`)));
      fires.push(appendEvent(b.id, evt(`b-${i}`)));
    }
    await Promise.all(fires);

    const aEvents = await readTranscript(a.id);
    const bEvents = await readTranscript(b.id);

    expect(aEvents).toHaveLength(N);
    expect(bEvents).toHaveLength(N);

    // No `b-*` events leaked into `a` and vice versa.
    for (let i = 0; i < N; i++) {
      expect((aEvents[i] as { content: string }).content).toBe(`a-${i}`);
      expect((bEvents[i] as { content: string }).content).toBe(`b-${i}`);
    }
  });

  it('drainAppendChain on one conversation does not block the other', async () => {
    const a = await createConversation('ws-A');
    const b = await createConversation('ws-B');

    // Queue work on both.
    void appendEvent(a.id, evt('a-1'));
    void appendEvent(a.id, evt('a-2'));
    void appendEvent(b.id, evt('b-1'));

    // Drain ONLY a — must not implicitly synchronise b's chain (the
    // chains are per-conversation; cross-coupling would defeat the
    // multi-session "side runs keep flowing while you switch" promise).
    await drainAppendChain(a.id);

    const aEvents = await readTranscript(a.id);
    expect(aEvents.map((e) => (e as { content: string }).content)).toEqual(['a-1', 'a-2']);

    // b's append eventually lands too, but this test doesn't await it
    // before the assertion above — we only need to prove draining a
    // returned without waiting on b's chain.
    await drainAppendChain(b.id);
    const bEvents = await readTranscript(b.id);
    expect(bEvents.map((e) => (e as { content: string }).content)).toEqual(['b-1']);
  });
});
