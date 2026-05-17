/**
 * `sanitizeToolCallPairing` is the last line of defense against the
 * "An assistant message with 'tool_calls' must be followed by tool
 * messages responding to each 'tool_call_id'." 400 from strict
 * OpenAI-compat providers (DeepSeek/OpenAI/OpenRouter). Lock the
 * contract in place so a future regression in `replayTranscript` (or
 * any other code path that reconstructs the `tool_calls` → `tool`
 * pairing) never silently breaks live runs.
 */

import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@shared/types/chat.js';
import {
  sanitizeToolCallPairing,
  sanitizeToolCallPairingWithStats
} from '@main/orchestrator/loop/sanitizeToolPairing';

function asst(toolCallIds: string[], content: string | null = ''): ChatMessage {
  return {
    role: 'assistant',
    content,
    tool_calls: toolCallIds.map((id, i) => ({
      id,
      type: 'function' as const,
      function: { name: `tool_${i}`, arguments: '{}' }
    }))
  };
}

function tool(id: string, content = 'ok'): ChatMessage {
  return { role: 'tool', tool_call_id: id, name: 'fn', content };
}

describe('sanitizeToolCallPairing', () => {
  it('passes through a fully-paired conversation untouched', () => {
    const msgs: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
      asst(['c1', 'c2']),
      tool('c1'),
      tool('c2'),
      { role: 'assistant', content: 'done', tool_calls: undefined }
    ];
    const out = sanitizeToolCallPairing(msgs);
    expect(out).toEqual(msgs);
    // Reference-equality check on the message instances proves the
    // sanitizer doesn't reallocate when there's nothing to fix.
    out.forEach((m, i) => expect(m).toBe(msgs[i]));
  });

  it('injects a stub for an orphan tool_call when the response block is empty', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'q' },
      asst(['orphan-1'])
    ];
    const out = sanitizeToolCallPairing(msgs);
    expect(out).toHaveLength(3);
    expect(out[2]?.role).toBe('tool');
    expect(out[2]?.tool_call_id).toBe('orphan-1');
    expect(typeof out[2]?.content).toBe('string');
    expect((out[2]?.content as string).length).toBeGreaterThan(0);
  });

  it('only injects stubs for the missing ids, leaving real tool messages in place', () => {
    const msgs: ChatMessage[] = [
      asst(['c1', 'c2', 'c3']),
      tool('c2', 'hello')
    ];
    const out = sanitizeToolCallPairing(msgs);
    // Original assistant + injected stubs for c1+c3 + real tool for c2.
    expect(out).toHaveLength(4);
    const toolIds = out
      .filter((m) => m.role === 'tool')
      .map((m) => m.tool_call_id);
    expect(toolIds).toContain('c1');
    expect(toolIds).toContain('c3');
    expect(toolIds).toContain('c2');
    // Real response is preserved with its original content.
    const real = out.find((m) => m.tool_call_id === 'c2');
    expect(real?.content).toBe('hello');
  });

  it('respects response-block boundaries (next assistant turn ends the block)', () => {
    // Block 1's orphan must NOT be paired by tool messages that live
    // after Block 2's assistant turn.
    const msgs: ChatMessage[] = [
      asst(['c1']),
      // No tool message for c1 in this block.
      asst(['c2'], 'mid'),
      tool('c2'),
      // A stray tool message for c1 living in the wrong block — the
      // sanitizer must NOT count it as a response for the first block,
      // AND must DROP it from the output because it is an orphan in
      // block 2's response scope (see `orphan role:'tool'` drop-pass).
      tool('c1', 'late')
    ];
    const out = sanitizeToolCallPairing(msgs);
    // Stub for c1 should be inserted right after the first assistant.
    expect(out[0]?.role).toBe('assistant');
    expect(out[1]?.role).toBe('tool');
    expect(out[1]?.tool_call_id).toBe('c1');
    expect((out[1]?.content as string).startsWith('(tool result missing')).toBe(true);
    // Block 2 remains — assistant + real c2 tool — but the stray
    // late-c1 tool has been DROPPED as an orphan.
    expect(out).toHaveLength(4);
    expect(out[2]).toBe(msgs[1]); // asst(['c2'])
    expect(out[3]).toBe(msgs[2]); // tool('c2')
  });

  /**
   * Orphan `role:'tool'` regression (audit Phase 9).
   *
   * Strict OpenAI-compat providers reject any `role:'tool'` message
   * whose `tool_call_id` does not match an id in the most recent
   * assistant message's `tool_calls`. Dropping these before the
   * request ships prevents a guaranteed 400 from a history that was
   * persisted with weaker pairing (e.g. reducer bug, older build).
   */
  describe('orphan role:tool drop pass', () => {
    it('drops an orphan tool message with no preceding assistant', () => {
      // A tool message before any assistant cannot possibly be valid.
      const msgs: ChatMessage[] = [
        { role: 'user', content: 'q' },
        tool('ghost-1', 'leaked from a previous run')
      ];
      const out = sanitizeToolCallPairing(msgs);
      expect(out).toHaveLength(1);
      expect(out[0]?.role).toBe('user');
    });

    it('drops a tool message whose id is not in the current assistant block', () => {
      // The assistant only issued c1; a stray tool message for c99
      // from a prior response block (or a reducer glitch) is an orphan.
      const msgs: ChatMessage[] = [
        asst(['c1']),
        tool('c1'),
        tool('c99', 'stray')
      ];
      const out = sanitizeToolCallPairing(msgs);
      expect(out).toHaveLength(2);
      expect(out.every((m) => m.role !== 'tool' || m.tool_call_id === 'c1')).toBe(true);
    });

    it('keeps tool messages that are valid responses for the current block', () => {
      const msgs: ChatMessage[] = [
        asst(['a', 'b']),
        tool('a'),
        tool('b')
      ];
      const out = sanitizeToolCallPairing(msgs);
      // Nothing to fix, nothing to drop — well-formed input passes
      // through with identity.
      expect(out).toEqual(msgs);
    });
  });

  it('handles assistant messages with empty / undefined tool_calls gracefully', () => {
    const msgs: ChatMessage[] = [
      { role: 'assistant', content: 'plain' },
      { role: 'assistant', content: 'also plain', tool_calls: [] }
    ];
    const out = sanitizeToolCallPairing(msgs);
    expect(out).toEqual(msgs);
  });

  it('produces a stub whose name matches the orphan tool_call function name', () => {
    const msgs: ChatMessage[] = [asst(['only'])];
    msgs[0]!.tool_calls![0]!.function.name = 'bash';
    const out = sanitizeToolCallPairing(msgs);
    expect(out[1]?.role).toBe('tool');
    expect(out[1]?.name).toBe('bash');
  });

  /**
   * Review finding H7 — orphan-stub injection MUST surface a count via
   * `sanitizeToolCallPairingWithStats` so the orchestrator's runLoop
   * can emit a single user-visible `phase` event ("Recovered N orphan
   * tool_call(s) ...") rather than silently mutating the wire shape.
   */
  describe('sanitizeToolCallPairingWithStats — H7 observability', () => {
    it('returns 0/0 stats on a clean transcript', () => {
      const msgs: ChatMessage[] = [
        { role: 'user', content: 'q' },
        { role: 'assistant', content: 'a' }
      ];
      const out = sanitizeToolCallPairingWithStats(msgs);
      expect(out.stats.injectedStubs).toBe(0);
      expect(out.stats.droppedOrphans).toBe(0);
      expect(out.messages).toHaveLength(msgs.length);
    });

    it('counts each injected stub exactly once', () => {
      const msgs: ChatMessage[] = [asst(['c1', 'c2', 'c3'])];
      const out = sanitizeToolCallPairingWithStats(msgs);
      // 3 unpaired tool_calls → 3 stubs injected.
      expect(out.stats.injectedStubs).toBe(3);
      expect(out.stats.droppedOrphans).toBe(0);
      expect(out.messages.filter((m) => m.role === 'tool')).toHaveLength(3);
    });

    it('counts each dropped orphan exactly once', () => {
      // Two orphan tool messages with no preceding assistant.
      const msgs: ChatMessage[] = [
        tool('orphan-a'),
        tool('orphan-b'),
        { role: 'user', content: 'q' }
      ];
      const out = sanitizeToolCallPairingWithStats(msgs);
      expect(out.stats.droppedOrphans).toBe(2);
      expect(out.stats.injectedStubs).toBe(0);
      // The user message survives.
      expect(out.messages.filter((m) => m.role === 'tool')).toHaveLength(0);
    });

    it('counts a mix of injected stubs and dropped orphans', () => {
      const msgs: ChatMessage[] = [
        tool('orphan-pre'),                  // 1 dropped
        asst(['c1', 'c2']),                  // 1 stub injected (only c1 paired below)
        tool('c1'),                          // paired
        // c2 has no matching tool message → 1 stub injected
        { role: 'user', content: 'next' },
        asst(['c3']),                        // 1 stub injected
        tool('orphan-post')                  // 1 dropped (no preceding assistant for it)
      ];
      const out = sanitizeToolCallPairingWithStats(msgs);
      // The orphan-post lives AFTER an assistant whose valid id is
      // c3, so its id `orphan-post` is not in `currentValidIds` →
      // dropped. The c3 assistant has no matching tool message →
      // stub injected.
      expect(out.stats.droppedOrphans).toBe(2);
      expect(out.stats.injectedStubs).toBe(2);
    });

    it('keeps the simple variant backward-compatible', () => {
      // The existing call sites that pass through SubAgent etc. must
      // keep returning a bare `ChatMessage[]`.
      const msgs: ChatMessage[] = [asst(['c1'])];
      const out = sanitizeToolCallPairing(msgs);
      expect(Array.isArray(out)).toBe(true);
      expect(out).toHaveLength(2); // assistant + injected stub
      expect(out[1]?.role).toBe('tool');
    });
  });
});
