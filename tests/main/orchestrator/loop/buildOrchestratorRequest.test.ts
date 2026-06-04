/**
 * Pins the request shape produced by `buildOrchestratorRequest` for the
 * forced-action loop.
 *
 *   - Default turn → `tool_choice:'required'` (the closed loop: every
 *     decision turn MUST be a tool call on a capable dialect).
 *   - Wrap-up synthesis turn → `tool_choice:'none'` (the provider is
 *     physically forced into prose for the final answer).
 *   - Non-forced dialect (`ollama-native`) → `temperature:0` plus a
 *     trailing prompt-force `user` message requiring at least one tool call
 *     (including multiple parallel `delegate` calls). The caller's history
 *     array is never mutated.
 *   - The orchestrator's tool catalogue is exactly `ORCHESTRATOR_TOOLS`.
 */

import { describe, expect, it } from 'vitest';
import { buildOrchestratorRequest } from '@main/orchestrator/loop/buildOrchestratorRequest';
import { ORCHESTRATOR_TOOLS } from '@main/tools/policy/index';
import type { ChatMessage } from '@shared/types/chat';
import type { ModelSelection } from '@shared/types/provider';

const selection: ModelSelection = { providerId: 'p', modelId: 'm' };

function baseMessages(): ChatMessage[] {
  return [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'do the thing' }
  ];
}

describe('buildOrchestratorRequest', () => {
  it('sends tool_choice:"required" by default (closed forced-action loop)', () => {
    const req = buildOrchestratorRequest({
      selection,
      messages: baseMessages(),
      signal: new AbortController().signal
    });
    expect(req.toolChoice).toBe('required');
    expect(req.providerId).toBe('p');
    expect(req.model).toBe('m');
  });

  it('exposes exactly the ORCHESTRATOR_TOOLS catalogue', () => {
    const req = buildOrchestratorRequest({
      selection,
      messages: baseMessages(),
      signal: new AbortController().signal
    });
    const names = (req.tools ?? []).map((t) => t.function.name).sort();
    expect(names).toEqual([...ORCHESTRATOR_TOOLS].sort());
  });

  it('sends tool_choice:"none" on the wrap-up synthesis turn and appends a synthesis instruction', () => {
    const messages = baseMessages();
    const req = buildOrchestratorRequest({
      selection,
      messages,
      signal: new AbortController().signal,
      wrapUp: true
    });
    expect(req.toolChoice).toBe('none');
    // A trailing synthesis instruction is appended as a user message.
    const last = req.messages[req.messages.length - 1]!;
    expect(last.role).toBe('user');
    expect(String(last.content)).toMatch(/final turn and tool calling is disabled/i);
    // No prompt-force temperature pin on the wrap-up turn.
    expect(req.temperature).toBeUndefined();
    // Caller's array is untouched.
    expect(messages).toHaveLength(2);
  });

  it('forced-capable dialects get no temperature pin and no extra prompt-force message', () => {
    const messages = baseMessages();
    const req = buildOrchestratorRequest({
      selection,
      messages,
      signal: new AbortController().signal,
      dialect: 'openai'
    });
    expect(req.toolChoice).toBe('required');
    expect(req.temperature).toBeUndefined();
    expect(req.messages).toHaveLength(2);
  });

  it('ollama-native gets temperature:0 and a trailing prompt-force user message', () => {
    const messages = baseMessages();
    const req = buildOrchestratorRequest({
      selection,
      messages,
      signal: new AbortController().signal,
      dialect: 'ollama-native'
    });
    // Still sends required (harmless / ignored by ollama) ...
    expect(req.toolChoice).toBe('required');
    // ... but adds the degradation knobs.
    expect(req.temperature).toBe(0);
    expect(req.messages).toHaveLength(3);
    const last = req.messages[req.messages.length - 1]!;
    expect(last.role).toBe('user');
    expect(String(last.content)).toMatch(/MUST call at least one tool/i);
    expect(String(last.content)).toMatch(/MULTIPLE `delegate`/i);
    // The caller's history array is not mutated.
    expect(messages).toHaveLength(2);
  });

  it('ollama-native wrap-up turn prefers prose (none) over prompt-force', () => {
    const req = buildOrchestratorRequest({
      selection,
      messages: baseMessages(),
      signal: new AbortController().signal,
      dialect: 'ollama-native',
      wrapUp: true
    });
    expect(req.toolChoice).toBe('none');
    // wrapUp suppresses the prompt-force temperature pin.
    expect(req.temperature).toBeUndefined();
    const last = req.messages[req.messages.length - 1]!;
    expect(String(last.content)).toMatch(/final turn and tool calling is disabled/i);
  });

  it('threads conversationId only when supplied', () => {
    const withId = buildOrchestratorRequest({
      selection,
      messages: baseMessages(),
      signal: new AbortController().signal,
      conversationId: 'conv-42'
    });
    expect(withId.conversationId).toBe('conv-42');
    const withoutId = buildOrchestratorRequest({
      selection,
      messages: baseMessages(),
      signal: new AbortController().signal
    });
    expect(withoutId.conversationId).toBeUndefined();
  });
});
