/**
 * `handleAssistantTurn` mid-stream `<delegate />` detection tests.
 *
 * The headline AUDIT §11.A fix: the moment a fully-formed `<delegate />`
 * directive lands in the running assistant text, the host emits a
 * `subagent-pending` timeline event so the renderer can surface a
 * pending sub-agent row WITHOUT waiting for the orchestrator turn to
 * finish streaming. We mock `streamChat` to feed deltas one at a time
 * and assert the right events fire (and dedup) at the right boundary.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ChatStreamDelta } from '@main/providers/chatClient';
import type { TimelineEvent } from '@shared/types/chat';

vi.mock('@main/providers/chatClient', () => ({
  streamChat: vi.fn()
}));

import { streamChat } from '@main/providers/chatClient';
import { handleAssistantTurn } from '@main/orchestrator/loop/handleAssistantTurn';

async function* asyncGen(
  deltas: ChatStreamDelta[]
): AsyncGenerator<ChatStreamDelta> {
  for (const d of deltas) yield d;
}

beforeEach(() => {
  vi.mocked(streamChat).mockReset();
});

describe('handleAssistantTurn — mid-stream <delegate /> detection', () => {
  it('emits subagent-pending the moment a complete directive arrives', async () => {
    vi.mocked(streamChat).mockReturnValue(
      asyncGen([
        { contentDelta: 'Plan: I will spawn a sub-agent.\n\n' },
        { contentDelta: '<delegate id="A1" task="Read foo.ts" files="foo.ts" />' },
        { contentDelta: '\n\nDone.' },
        { finishReason: 'stop' }
      ])
    );
    const events: TimelineEvent[] = [];
    const out = await handleAssistantTurn(
      { providerId: 'p', model: 'm', messages: [], signal: new AbortController().signal },
      (e) => events.push(e)
    );

    const pending = events.filter((e) => e.kind === 'subagent-pending');
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      kind: 'subagent-pending',
      subagentId: 'A1',
      task: 'Read foo.ts',
      files: ['foo.ts']
    });
    expect(out.error).toBeUndefined();
  });

  it('does not emit a duplicate pending row for the same id', async () => {
    // Same directive arriving across two deltas → still one event.
    vi.mocked(streamChat).mockReturnValue(
      asyncGen([
        { contentDelta: '<delegate id="A1" task="A" files="" />' },
        { contentDelta: ' more text' },
        { finishReason: 'stop' }
      ])
    );
    const events: TimelineEvent[] = [];
    await handleAssistantTurn(
      { providerId: 'p', model: 'm', messages: [], signal: new AbortController().signal },
      (e) => events.push(e)
    );
    expect(events.filter((e) => e.kind === 'subagent-pending')).toHaveLength(1);
  });

  it('emits one pending row per distinct directive id in the same turn', async () => {
    vi.mocked(streamChat).mockReturnValue(
      asyncGen([
        { contentDelta: '<delegate id="A1" task="t1" />' },
        { contentDelta: '<delegate id="A2" task="t2" />' },
        { finishReason: 'stop' }
      ])
    );
    const events: TimelineEvent[] = [];
    await handleAssistantTurn(
      { providerId: 'p', model: 'm', messages: [], signal: new AbortController().signal },
      (e) => events.push(e)
    );
    const pending = events.filter((e) => e.kind === 'subagent-pending');
    expect(pending.map((e) => (e as { subagentId: string }).subagentId)).toEqual([
      'A1',
      'A2'
    ]);
  });

  it('does not emit pending for a partial directive at the buffer tail', async () => {
    // Tail is mid-tag — must NOT match.
    vi.mocked(streamChat).mockReturnValue(
      asyncGen([
        { contentDelta: 'thinking…\n<delegate id="A1" tas' },
        { finishReason: 'stop' }
      ])
    );
    const events: TimelineEvent[] = [];
    await handleAssistantTurn(
      { providerId: 'p', model: 'm', messages: [], signal: new AbortController().signal },
      (e) => events.push(e)
    );
    expect(events.filter((e) => e.kind === 'subagent-pending')).toHaveLength(0);
  });

  /**
   * Performance regression: `parseDelegates` scans the WHOLE
   * accumulated buffer on every call. Before the gate, a reasoning-
   * heavy stream of plain prose tokens (no `<` / `>` ever appearing)
   * would still pay the regex cost on every delta. The gate skips
   * `parseDelegates` whenever the delta contains neither `<` nor
   * `>` — semantic behavior is unchanged because a directive cannot
   * have NEWLY closed without one of those code points showing up
   * in the delta that completed it.
   *
   * We exercise the gate by feeding a long stream of plain prose
   * deltas with no XML sigils and confirming that:
   *   - no `subagent-pending` event fires (correctness preserved)
   *   - the assembled assistantText is the verbatim concatenation
   *     (no truncation / no skip of harmless deltas).
   *
   * A direct spy on `parseDelegates` would require restructuring
   * the import; the absence-of-pending assertion plus the explicit
   * sigil presence in the FOLLOWING test below covers the gate's
   * two paths (skip vs. trigger) end-to-end.
   */
  it('skips delegate parsing on deltas without `<` or `>` while preserving correctness', async () => {
    const proseChunks = [
      'Reasoning step one: examine the workspace structure.\n',
      'Reasoning step two: enumerate the candidate files.\n',
      'Reasoning step three: weigh the trade-offs.\n',
      'Reasoning step four: propose a plan.\n',
      'Final answer: I will summarize the workspace in five bullets.\n'
    ];
    vi.mocked(streamChat).mockReturnValue(
      asyncGen([
        ...proseChunks.map((c) => ({ contentDelta: c })),
        { finishReason: 'stop' }
      ])
    );
    const events: TimelineEvent[] = [];
    const out = await handleAssistantTurn(
      { providerId: 'p', model: 'm', messages: [], signal: new AbortController().signal },
      (e) => events.push(e)
    );
    expect(events.filter((e) => e.kind === 'subagent-pending')).toHaveLength(0);
    expect(out.assistantText).toBe(proseChunks.join(''));
  });

  /**
   * Companion to the gate-skip test: when a delta DOES contain a
   * sigil (`<` or `>`), parseDelegates runs and surfaces the
   * directive normally. Combined with the skip test above, this pins
   * both sides of the gate.
   */
  it('still detects a directive when the closing `>` arrives in a later delta', async () => {
    vi.mocked(streamChat).mockReturnValue(
      asyncGen([
        // Open the directive across multiple deltas — none contain
        // the closing `>` until the very last one.
        { contentDelta: 'Plan: spawn worker.\n' },
        { contentDelta: '<delegate id="A1" task="t1"' },
        { contentDelta: ' files="foo.ts"' },
        // Closing sigil lands here — parseDelegates fires only on
        // this delta thanks to the gate, but the result is identical.
        { contentDelta: ' />' },
        { contentDelta: '\nDone.' },
        { finishReason: 'stop' }
      ])
    );
    const events: TimelineEvent[] = [];
    await handleAssistantTurn(
      { providerId: 'p', model: 'm', messages: [], signal: new AbortController().signal },
      (e) => events.push(e)
    );
    const pending = events.filter((e) => e.kind === 'subagent-pending');
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      kind: 'subagent-pending',
      subagentId: 'A1'
    });
  });

  /**
   * T0-7 — when the caller passes a shared `seenDelegateIds` Set, two
   * sequential calls to `handleAssistantTurn` (simulating two
   * assistant turns inside the same iteration) MUST NOT re-emit
   * `subagent-pending` for ids the first turn already surfaced.
   *
   * This is the runLoop-scoped dedup: the per-turn Set is the legacy
   * default, and a hoisted run-scoped Set takes precedence when the
   * caller provides one.
   */
  it('dedupes `subagent-pending` across calls when given a shared id set (T0-7)', async () => {
    const sharedIds = new Set<string>();

    // First call: the model emits a directive for A1.
    vi.mocked(streamChat).mockReturnValueOnce(
      asyncGen([
        { contentDelta: '<delegate id="A1" task="t1" files="foo" />' },
        { finishReason: 'stop' }
      ])
    );
    const events1: TimelineEvent[] = [];
    await handleAssistantTurn(
      { providerId: 'p', model: 'm', messages: [], signal: new AbortController().signal },
      (e) => events1.push(e),
      undefined,
      sharedIds
    );
    expect(events1.filter((e) => e.kind === 'subagent-pending')).toHaveLength(1);
    // The shared set now carries A1.
    expect(sharedIds.has('A1')).toBe(true);

    // Second call (same iteration, second assistant turn): the model
    // re-emits the SAME A1 directive AND introduces a fresh A2.
    vi.mocked(streamChat).mockReturnValueOnce(
      asyncGen([
        { contentDelta: '<delegate id="A1" task="t1" files="foo" />' },
        { contentDelta: '<delegate id="A2" task="t2" files="bar" />' },
        { finishReason: 'stop' }
      ])
    );
    const events2: TimelineEvent[] = [];
    await handleAssistantTurn(
      { providerId: 'p', model: 'm', messages: [], signal: new AbortController().signal },
      (e) => events2.push(e),
      undefined,
      sharedIds
    );
    const pending2 = events2.filter(
      (e): e is Extract<TimelineEvent, { kind: 'subagent-pending' }> =>
        e.kind === 'subagent-pending'
    );
    // Only the FRESH id (A2) produces a new pending row; A1 was
    // already in the shared set and is suppressed.
    expect(pending2).toHaveLength(1);
    expect(pending2[0]?.subagentId).toBe('A2');
    expect(sharedIds.has('A2')).toBe(true);
  });

  /**
   * Backward-compat regression — when the optional 4th argument is
   * omitted, every call gets a FRESH per-turn Set so the legacy
   * caller (sub-agent path, tests) behaves exactly as before.
   */
  it('defaults to a per-turn id set when none is provided (T0-7 back-compat)', async () => {
    vi.mocked(streamChat).mockReturnValueOnce(
      asyncGen([
        { contentDelta: '<delegate id="A1" task="t1" />' },
        { finishReason: 'stop' }
      ])
    );
    const events1: TimelineEvent[] = [];
    await handleAssistantTurn(
      { providerId: 'p', model: 'm', messages: [], signal: new AbortController().signal },
      (e) => events1.push(e)
    );
    expect(events1.filter((e) => e.kind === 'subagent-pending')).toHaveLength(1);

    // Second call without a shared set: A1 should produce a fresh
    // pending event because the per-turn Set started empty.
    vi.mocked(streamChat).mockReturnValueOnce(
      asyncGen([
        { contentDelta: '<delegate id="A1" task="t1" />' },
        { finishReason: 'stop' }
      ])
    );
    const events2: TimelineEvent[] = [];
    await handleAssistantTurn(
      { providerId: 'p', model: 'm', messages: [], signal: new AbortController().signal },
      (e) => events2.push(e)
    );
    expect(events2.filter((e) => e.kind === 'subagent-pending')).toHaveLength(1);
  });
});
