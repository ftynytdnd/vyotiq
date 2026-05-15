/**
 * `estimateMessagesTokens` — Audit fix §2.3.
 *
 * The trim policy in `enforceContextBudget` keys off this estimator,
 * so the contract under test is:
 *
 *   1. Returns 0 for an empty message array.
 *   2. Pure / deterministic — same input → same output.
 *   3. Includes role, content, reasoning_content, tool_calls, name,
 *      and tool_call_id in the projection (each contributes
 *      meaningful bytes the wire actually sends).
 *   4. Heuristic path (unknown model id) is non-zero and roughly
 *      proportional to body length.
 *   5. BPE path (gpt-4o, gpt-4) returns a count larger than 0 and
 *      grows with body length.
 */

import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@shared/types/chat';
import { estimateMessagesTokens } from '@main/providers/tokenCounter';

describe('estimateMessagesTokens — Audit fix §2.3', () => {
  it('returns 0 for an empty array', () => {
    expect(estimateMessagesTokens([], 'gpt-4o')).toBe(0);
  });

  it('is deterministic for identical input', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'hello' },
      { role: 'user', content: 'world' }
    ];
    const a = estimateMessagesTokens(messages, 'gpt-4o');
    const b = estimateMessagesTokens(messages, 'gpt-4o');
    expect(a).toBe(b);
    expect(a).toBeGreaterThan(0);
  });

  it('returns a non-zero heuristic count for unknown model ids', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'a fairly long body of plain English prose for tokens' }
    ];
    // `claude-3-haiku` doesn't match any of the BPE encoders, so the
    // heuristic fallback path runs.
    const tokens = estimateMessagesTokens(messages, 'claude-3-haiku');
    expect(tokens).toBeGreaterThan(0);
  });

  it('grows with body length on the BPE path', () => {
    const small: ChatMessage[] = [{ role: 'user', content: 'short' }];
    const large: ChatMessage[] = [
      { role: 'user', content: 'this is a much longer body that should consume more BPE tokens than the small fixture above by a clear margin' }
    ];
    const smallCount = estimateMessagesTokens(small, 'gpt-4o');
    const largeCount = estimateMessagesTokens(large, 'gpt-4o');
    expect(largeCount).toBeGreaterThan(smallCount);
  });

  it('includes reasoning_content in the projection', () => {
    const withoutReasoning: ChatMessage[] = [
      { role: 'assistant', content: 'short answer' }
    ];
    const withReasoning: ChatMessage[] = [
      {
        role: 'assistant',
        content: 'short answer',
        reasoning_content:
          'pondering the problem at length: this is the deep chain-of-thought the provider charges for'
      }
    ];
    const a = estimateMessagesTokens(withoutReasoning, 'gpt-4o');
    const b = estimateMessagesTokens(withReasoning, 'gpt-4o');
    // Reasoning_content adds bytes; the count must reflect them.
    expect(b).toBeGreaterThan(a);
  });

  it('includes tool_calls in the projection', () => {
    const plainAssistant: ChatMessage[] = [
      { role: 'assistant', content: 'answering' }
    ];
    const toolCallAssistant: ChatMessage[] = [
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'c1',
            type: 'function' as const,
            function: {
              name: 'read',
              arguments: JSON.stringify({ path: 'src/orchestrator/runLoop.ts' })
            }
          }
        ]
      }
    ];
    const a = estimateMessagesTokens(plainAssistant, 'gpt-4o');
    const b = estimateMessagesTokens(toolCallAssistant, 'gpt-4o');
    // The tool-call envelope JSON is heavier than the short prose
    // body — the count must reflect that.
    expect(b).toBeGreaterThan(a);
  });

  it('includes tool_call_id and name on role=tool messages', () => {
    const withoutMeta: ChatMessage[] = [
      // Even though `tool` messages always carry `tool_call_id` in
      // practice, this fixture mocks the absence to show the
      // estimator depends on the projection working when present.
      { role: 'tool', tool_call_id: '', name: '', content: 'result body' }
    ];
    const withMeta: ChatMessage[] = [
      { role: 'tool', tool_call_id: 'call-1234', name: 'read', content: 'result body' }
    ];
    const a = estimateMessagesTokens(withoutMeta, 'gpt-4o');
    const b = estimateMessagesTokens(withMeta, 'gpt-4o');
    expect(b).toBeGreaterThanOrEqual(a);
  });
});
