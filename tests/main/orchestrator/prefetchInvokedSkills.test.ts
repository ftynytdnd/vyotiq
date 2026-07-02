import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prefetchInvokedSkills } from '@main/orchestrator/prefetchInvokedSkills';
import type { ChatMessage, TimelineEvent } from '@shared/types/chat.js';
import { seedCacheLayeredMessages } from '@main/orchestrator/context/buildContextLayers.js';

function layeredMessages(turnBody: string): ChatMessage[] {
  return seedCacheLayeredMessages([], turnBody);
}

describe('prefetchInvokedSkills', () => {
  it('inserts assistant tool-call and tool result for invoked skill', async () => {
    const messages = layeredMessages('<turn><user_message>go</user_message></turn>');
    const events: TimelineEvent[] = [];
    const ac = new AbortController();

    await prefetchInvokedSkills({
      invokedSkills: ['deliverables'],
      workspacePath: '/tmp',
      workspaceId: 'ws',
      runId: 'run',
      conversationId: 'conv',
      signal: ac.signal,
      messages,
      emit: (e) => events.push(e)
    });

    const assistant = messages.find((m) => m.role === 'assistant' && m.tool_calls?.length);
    expect(assistant?.tool_calls?.[0]?.function.name).toBe('context');
    const tool = messages.find((m) => m.role === 'tool' && m.name === 'context');
    expect(tool?.content).toContain('Deliverables');
    expect(events.some((e) => e.kind === 'tool-call')).toBe(true);
    expect(events.some((e) => e.kind === 'tool-result')).toBe(true);
  });

  it('emits agent-thought when prefetch fails', async () => {
    const messages = layeredMessages('<turn><user_message>go</user_message></turn>');
    const events: TimelineEvent[] = [];
    const ac = new AbortController();

    await prefetchInvokedSkills({
      invokedSkills: ['definitely-not-a-real-skill-name-xyz'],
      workspacePath: '/tmp',
      workspaceId: 'ws',
      runId: 'run',
      conversationId: 'conv',
      signal: ac.signal,
      messages,
      emit: (e) => events.push(e)
    });

    expect(events.some((e) => e.kind === 'agent-thought' && e.severity === 'warn')).toBe(true);
    expect(messages.find((m) => m.role === 'tool' && m.name === 'context')).toBeUndefined();
  });

  it('resolves slash aliases before loading', async () => {
    const messages = layeredMessages('<turn><user_message>go</user_message></turn>');
    const events: TimelineEvent[] = [];
    const ac = new AbortController();

    await prefetchInvokedSkills({
      invokedSkills: ['review'],
      workspacePath: '/tmp',
      workspaceId: 'ws',
      runId: 'run',
      conversationId: 'conv',
      signal: ac.signal,
      messages,
      emit: (e) => events.push(e)
    });

    const tool = messages.find((m) => m.role === 'tool' && m.name === 'context');
    expect(tool?.content?.length).toBeGreaterThan(0);
    expect(events.some((e) => e.kind === 'tool-call')).toBe(true);
  });

  it('dedupes second prefetch for same skill', async () => {
    const messages = layeredMessages('<turn><user_message>go</user_message></turn>');
    const ac = new AbortController();
    const opts = {
      invokedSkills: ['static-examples'],
      workspacePath: '/tmp' as const,
      workspaceId: 'ws',
      runId: randomUUID(),
      conversationId: 'conv',
      signal: ac.signal,
      messages,
      emit: () => {}
    };
    await prefetchInvokedSkills(opts);
    const countAfterFirst = messages.filter((m) => m.role === 'tool').length;
    await prefetchInvokedSkills(opts);
    expect(messages.filter((m) => m.role === 'tool').length).toBe(countAfterFirst);
  });
});
