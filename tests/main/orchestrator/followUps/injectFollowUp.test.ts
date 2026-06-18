/**
 * Mid-loop follow-up injection — user envelope + timeline event.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ChatMessage } from '@shared/types/chat.js';
import type { FollowUpMessage } from '@shared/types/followUp.js';
import { injectFollowUp } from '@main/orchestrator/followUps/injectFollowUp.js';

const appendEventMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('@main/conversations/conversationStore.js', () => ({
  appendEvent: (...args: unknown[]) => appendEventMock(...args)
}));

vi.mock('@main/attachments/resolveAttachmentsForInline.js', () => ({
  resolveAttachmentsForInline: vi.fn(async () => '')
}));

vi.mock('@main/attachments/resolveMentionsForInline.js', () => ({
  resolveMentionsForInline: vi.fn(async () => '')
}));

function sampleFollowUp(overrides: Partial<FollowUpMessage> = {}): FollowUpMessage {
  return {
    id: 'fu-1',
    kind: 'steering',
    prompt: 'Please continue with tests',
    selection: { providerId: 'p1', modelId: 'm1' },
    queuedAt: Date.now(),
    source: 'composer',
    ...overrides
  };
}

describe('injectFollowUp', () => {
  beforeEach(() => {
    appendEventMock.mockClear();
  });

  it('emits user-prompt, persists, and inserts a user message into the loop', async () => {
    const emitted: unknown[] = [];
    const messages: ChatMessage[] = [
      { role: 'system', content: '' },
      { role: 'user', content: '<turn><user_message>hi</user_message></turn>' }
    ];

    const result = await injectFollowUp({
      followUp: sampleFollowUp(),
      runId: 'run-1',
      conversationId: 'conv-1',
      workspacePath: '/tmp/ws',
      emit: (event) => emitted.push(event),
      messages
    });

    expect(result.query).toBe('Please continue with tests');
    expect(emitted).toHaveLength(1);
    const event = emitted[0] as { kind: string; content: string; runId: string };
    expect(event.kind).toBe('user-prompt');
    expect(event.content).toBe('Please continue with tests');
    expect(event.runId).toBe('run-1');
    expect(appendEventMock).toHaveBeenCalledWith('conv-1', expect.objectContaining({ kind: 'user-prompt' }));

    const tail = messages[messages.length - 1];
    expect(tail?.role).toBe('user');
    expect(typeof tail?.content).toBe('string');
    expect(tail?.content).toContain('<user_message>');
    expect(tail?.content).toContain('Please continue with tests');
  });

  it('throws when appendEvent fails before emit or loop insert', async () => {
    appendEventMock.mockRejectedValueOnce(new Error('disk full'));
    const emitted: unknown[] = [];
    const messages: ChatMessage[] = [
      { role: 'system', content: '' },
      { role: 'user', content: '<turn><user_message>hi</user_message></turn>' }
    ];

    await expect(
      injectFollowUp({
        followUp: sampleFollowUp(),
        runId: 'run-1',
        conversationId: 'conv-1',
        workspacePath: '/tmp/ws',
        emit: (event) => emitted.push(event),
        messages
      })
    ).rejects.toThrow('disk full');

    expect(emitted).toHaveLength(0);
    expect(messages).toHaveLength(2);
  });
});
