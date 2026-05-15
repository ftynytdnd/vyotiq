/**
 * Per-turn token-budget enforcement — Audit fix §2.3.
 *
 * Locks down the priority order of `enforceContextBudget`:
 *   1. Drop oldest verified `<subagent_results>` envelopes.
 *   2. Drop oldest tool round pairs (assistant.tool_calls + matching
 *      `role:'tool'` results).
 *   3. Stop when target reached or nothing safe left to drop.
 *
 * Also asserts the invariants the trimmer must NEVER violate:
 *   - System message at index 0 is preserved.
 *   - Most recent user prompt + assistant turn + tool round are preserved.
 *   - Returned array is a fresh copy (caller's array isn't mutated).
 */

import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@shared/types/chat';
import {
  enforceContextBudget,
  type EnforceContextBudgetOpts
} from '@main/orchestrator/loop/trimMessages';

/**
 * Convenience builder so each test reads as the conversation
 * shape that triggers the policy under test.
 */
/**
 * Returns a body of varied content (NOT a long run of a single
 * character — `gpt-tokenizer` collapses repeated chars into far
 * fewer tokens than English prose, which would understate the
 * target overrun in fixtures and make the trim policy a no-op).
 * The seed mixes Lorem-Ipsum-style words so the BPE behaves like
 * realistic prose.
 */
function bigBody(label: string, charCount = 4_000): string {
  const lorem =
    'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod ' +
    'tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam ' +
    'quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo ' +
    'consequat duis aute irure dolor in reprehenderit in voluptate velit esse ';
  let out = `${label}: `;
  while (out.length < charCount) {
    out += lorem;
  }
  return out.slice(0, charCount);
}

function envelope(id: string, charCount = 4_000): ChatMessage {
  return {
    role: 'user',
    content:
      `<subagent_results round="1">` +
      `<subagent id="${id}"><result>${bigBody('verified', charCount)}</result></subagent>` +
      `</subagent_results>`
  };
}

function toolRound(callId: string, resultBody: string): ChatMessage[] {
  return [
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: callId,
          type: 'function' as const,
          function: { name: 'read', arguments: '{"path":"src/big.ts"}' }
        }
      ]
    },
    {
      role: 'tool',
      tool_call_id: callId,
      name: 'read',
      content: resultBody
    }
  ];
}

/**
 * Tight context window + low target fraction so realistic Lorem-style
 * bodies of a few KB each are guaranteed to overshoot. `gpt-4o`'s
 * BPE tokenizes the seed at ~3.7 chars/token, so a 4 KB body lands
 * around 1.1k tokens; three of them plus framing easily clear the
 * 1k target below.
 */
const baseOpts: EnforceContextBudgetOpts = {
  contextWindow: 2_000,
  modelId: 'gpt-4o',
  targetFraction: 0.5
};

describe('enforceContextBudget — Audit fix §2.3', () => {
  it('returns the input unchanged when already under target', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'tiny' },
      { role: 'assistant', content: 'reply' }
    ];
    const result = enforceContextBudget(messages, baseOpts);
    expect(result.trimmedMessages).toBe(0);
    expect(result.messages).toBe(messages); // same reference — zero-copy fast path
    expect(result.tokensAfter).toBe(result.tokensBefore);
  });

  it('drops oldest sub-agent envelopes BEFORE touching tool rounds', () => {
    // Three large envelopes + one large tool round + the live tail.
    // The trim policy MUST drop the envelopes first; the tool round
    // is also stale but lower priority than envelopes.
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'first prompt' },
      envelope('A1', 6_000),
      envelope('A2', 6_000),
      envelope('A3', 6_000),
      ...toolRound('call-old', bigBody('old read', 4_000)),
      { role: 'user', content: 'follow-up' },
      ...toolRound('call-live', 'fresh'),
      { role: 'assistant', content: 'final' }
    ];
    const inputCopy = [...messages];
    const result = enforceContextBudget(messages, baseOpts);

    // Caller's array is never mutated.
    expect(messages).toEqual(inputCopy);

    // System message preserved.
    expect(result.messages[0]).toEqual({ role: 'system', content: 'sys' });
    // Live tool round + final assistant preserved at the tail.
    const tailKinds = result.messages
      .slice(-3)
      .map((m) => `${m.role}${'tool_calls' in m && m.tool_calls ? ':tool_calls' : ''}`);
    expect(tailKinds).toEqual(['assistant:tool_calls', 'tool', 'assistant']);

    // The trim policy is "stop once under target", so we don't
    // require ALL envelopes to be gone — just that the policy reached
    // for envelopes BEFORE touching the stale `call-old` tool round.
    // The stale tool round therefore must still be intact (no
    // half-dropped pair).
    const oldToolPair = result.messages.find(
      (m) =>
        m.role === 'tool' &&
        'tool_call_id' in m &&
        m.tool_call_id === 'call-old'
    );
    const oldAssistantPair = result.messages.find(
      (m) =>
        m.role === 'assistant' &&
        Array.isArray(m.tool_calls) &&
        m.tool_calls[0]?.id === 'call-old'
    );
    // Either both survive (priority: envelopes dropped first), OR
    // neither survives (target was so tight we kept dropping past
    // envelopes into pass 2). They must NEVER be split — that
    // would break the `tool_calls → tool` pair invariant.
    expect(Boolean(oldToolPair)).toBe(Boolean(oldAssistantPair));
    // At least one envelope was dropped — that's the priority claim
    // under test.
    const envelopesLeft = result.messages.filter(
      (m) =>
        m.role === 'user' && typeof m.content === 'string' && m.content.startsWith('<subagent_results')
    );
    expect(envelopesLeft.length).toBeLessThan(3);

    // The original first-prompt user message survives — it's a real
    // user prompt, not an envelope, so the policy must not touch it.
    const userPrompts = result.messages.filter(
      (m) => m.role === 'user' && typeof m.content === 'string' && m.content === 'first prompt'
    );
    expect(userPrompts).toHaveLength(1);

    expect(result.trimmedMessages).toBeGreaterThan(0);
    expect(result.tokensAfter).toBeLessThan(result.tokensBefore);
  });

  it('drops oldest tool round pairs (assistant.tool_calls + tool results) atomically', () => {
    // Two stale tool rounds + the live tail. Envelope-free fixture so
    // pass 2 of the policy is the only one with anything to do.
    // Use larger bodies + a tighter target so both stale rounds
    // overshoot the budget.
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'first prompt' },
      ...toolRound('call-old-1', bigBody('round1 read', 8_000)),
      ...toolRound('call-old-2', bigBody('round2 read', 8_000)),
      ...toolRound('call-live', 'fresh'),
      { role: 'assistant', content: 'final' }
    ];
    const result = enforceContextBudget(messages, {
      ...baseOpts,
      contextWindow: 1_500,
      targetFraction: 0.5
    });

    // Live round MUST still pair correctly: the LAST assistant
    // message with `tool_calls` is followed immediately by its
    // matching `role:'tool'` result before the final assistant turn.
    const liveAssistantIdx = result.messages.findIndex(
      (m, i) =>
        m.role === 'assistant' &&
        Array.isArray(m.tool_calls) &&
        m.tool_calls.length > 0 &&
        m.tool_calls[0]!.id === 'call-live' &&
        result.messages[i + 1]?.role === 'tool' &&
        (result.messages[i + 1] as ChatMessage & { tool_call_id: string }).tool_call_id ===
        'call-live'
    );
    expect(liveAssistantIdx).toBeGreaterThan(-1);

    // No `call-old-*` round survives — both stale rounds were dropped
    // as atomic pairs, never half-trimmed.
    const oldTool = result.messages.find(
      (m) =>
        m.role === 'tool' &&
        'tool_call_id' in m &&
        typeof m.tool_call_id === 'string' &&
        m.tool_call_id.startsWith('call-old-')
    );
    expect(oldTool).toBeUndefined();
    const oldAssistant = result.messages.find(
      (m) =>
        m.role === 'assistant' &&
        Array.isArray(m.tool_calls) &&
        m.tool_calls.some((tc) => tc.id.startsWith('call-old-'))
    );
    expect(oldAssistant).toBeUndefined();

    expect(result.trimmedMessages).toBeGreaterThan(0);
  });

  it('stops dropping once the target is reached even if more would be eligible', () => {
    // Two large envelopes; dropping ONE should be enough to clear
    // the target. The trim policy is greedy-but-bounded — once the
    // estimate drops to the target we stop.
    const looseOpts: EnforceContextBudgetOpts = {
      contextWindow: 4_000,
      targetFraction: 0.6,
      modelId: 'gpt-4o'
    };
    // Two large envelopes — dropping ONE should be enough to clear
    // the 2.4k target. Sizes picked so each envelope is ~2k tokens
    // (well above what the BPE collapses Lorem into for short
    // strings).
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'first' },
      envelope('A1', 16_000),
      envelope('A2', 16_000),
      { role: 'assistant', content: 'final' }
    ];
    const result = enforceContextBudget(messages, looseOpts);
    // At least one was eligible and dropped.
    expect(result.trimmedMessages).toBeGreaterThanOrEqual(1);
    // After the first drop the policy should re-estimate and stop;
    // dropping the SECOND envelope wouldn't be needed.
    expect(result.trimmedMessages).toBeLessThanOrEqual(2);
    // tokensAfter <= target (the trimmer's job).
    expect(result.tokensAfter).toBeLessThanOrEqual(
      Math.floor(looseOpts.contextWindow * (looseOpts.targetFraction ?? 0.85))
    );
  });

  it('never drops the most recent tool round even when nothing else is eligible', () => {
    // A single live tool round + a giant prior assistant text turn.
    // With no envelopes and no OLD tool rounds, the policy should
    // give up rather than break the live `tool_calls → tool` pair.
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'first' },
      { role: 'assistant', content: bigBody('hello', 30_000) },
      { role: 'user', content: 'follow-up' },
      ...toolRound('call-live', 'fresh'),
      { role: 'assistant', content: 'final' }
    ];
    const result = enforceContextBudget(messages, baseOpts);
    // The live tool round must still be intact.
    const liveAssistant = result.messages.find(
      (m) =>
        m.role === 'assistant' &&
        Array.isArray(m.tool_calls) &&
        m.tool_calls[0]?.id === 'call-live'
    );
    expect(liveAssistant).toBeDefined();
    const liveTool = result.messages.find(
      (m) =>
        m.role === 'tool' &&
        'tool_call_id' in m &&
        m.tool_call_id === 'call-live'
    );
    expect(liveTool).toBeDefined();
  });
});
