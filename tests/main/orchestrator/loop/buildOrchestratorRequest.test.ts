/**
 * Pins the request shape produced by `buildOrchestratorRequest`.
 */

import { describe, expect, it } from 'vitest';
import { buildOrchestratorRequest } from '@main/orchestrator/loop/buildOrchestratorRequest';
import { AGENT_TOOLS } from '@main/tools/policy/agentTools';
import type { ChatMessage } from '@shared/types/chat';
import type { ModelSelection } from '@shared/types/provider';

const selection: ModelSelection = { providerId: 'p', modelId: 'm' };

const deepSeekThinkingCaps = {
  supported: true,
  wireStyle: 'openai-deepseek' as const,
  rejectsToolChoice: true,
  defaultOn: true
};

function baseMessages(): ChatMessage[] {
  return [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'do the thing' }
  ];
}

describe('buildOrchestratorRequest', () => {
  it('sends tool_choice:"auto" on normal turns', () => {
    const req = buildOrchestratorRequest({
      selection,
      messages: baseMessages(),
      signal: new AbortController().signal,
      dialect: 'openai'
    });
    expect(req.toolChoice).toBe('auto');
    expect(req.providerId).toBe('p');
    expect(req.model).toBe('m');
    expect(req.temperature).toBeUndefined();
    expect(req.messages).toHaveLength(2);
  });

  it('exposes exactly the AGENT_TOOLS catalogue', () => {
    const req = buildOrchestratorRequest({
      selection,
      messages: baseMessages(),
      signal: new AbortController().signal
    });
    const names = (req.tools ?? []).map((t) => t.function.name).sort();
    expect(names).toEqual([...AGENT_TOOLS].sort());
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
    const last = req.messages[req.messages.length - 1]!;
    expect(last.role).toBe('user');
    expect(String(last.content)).toMatch(/final turn and tool calling is disabled/i);
    expect(req.temperature).toBeUndefined();
    expect(messages).toHaveLength(2);
  });

  it('OMITS tool_choice for always-thinking deepseek-v4-flash (avoids the 400)', () => {
    const messages = baseMessages();
    const req = buildOrchestratorRequest({
      selection: { providerId: 'p', modelId: 'deepseek-v4-flash' },
      messages,
      signal: new AbortController().signal,
      dialect: 'openai',
      modelThinkingCaps: deepSeekThinkingCaps
    });
    // No `tool_choice` field at all — the wire defaults to `auto`.
    expect(req.toolChoice).toBeUndefined();
    // Tools are still offered on a normal turn.
    expect((req.tools ?? []).length).toBeGreaterThan(0);
    expect(req.temperature).toBeUndefined();
    expect(req.messages).toHaveLength(2);
    expect(messages).toHaveLength(2);
  });

  it('drops the tool list (not tool_choice:"none") on wrap-up for tool_choice-rejecting models', () => {
    const req = buildOrchestratorRequest({
      selection: { providerId: 'p', modelId: 'deepseek-v4-pro' },
      messages: baseMessages(),
      signal: new AbortController().signal,
      dialect: 'openai',
      wrapUp: true,
      modelThinkingCaps: deepSeekThinkingCaps
    });
    expect(req.toolChoice).toBeUndefined();
    expect(req.tools).toEqual([]);
  });

  it('re-enables tool_choice for deepseek when effort is explicitly off', () => {
    const req = buildOrchestratorRequest({
      selection: { providerId: 'p', modelId: 'deepseek-v4-flash' },
      messages: baseMessages(),
      signal: new AbortController().signal,
      dialect: 'openai',
      reasoningEffort: 'off',
      modelThinkingCaps: deepSeekThinkingCaps
    });
    expect(req.toolChoice).toBe('auto');
    expect(req.reasoningEffort).toBe('off');
  });

  it('honours the run-scoped omitToolChoice override even for capable models', () => {
    const req = buildOrchestratorRequest({
      selection,
      messages: baseMessages(),
      signal: new AbortController().signal,
      dialect: 'openai',
      omitToolChoice: true
    });
    expect(req.toolChoice).toBeUndefined();
  });

  it('threads a resolved reasoningEffort onto the request', () => {
    const req = buildOrchestratorRequest({
      selection,
      messages: baseMessages(),
      signal: new AbortController().signal,
      dialect: 'openai',
      reasoningEffort: 'high'
    });
    expect(req.reasoningEffort).toBe('high');
  });

  it('ollama-native uses auto without trailing force instructions', () => {
    const messages = baseMessages();
    const req = buildOrchestratorRequest({
      selection,
      messages,
      signal: new AbortController().signal,
      dialect: 'ollama-native'
    });
    expect(req.toolChoice).toBe('auto');
    expect(req.temperature).toBeUndefined();
    expect(req.messages).toHaveLength(2);
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
