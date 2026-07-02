import { describe, expect, it, vi } from 'vitest';
import type { TimelineEvent } from '@shared/types/chat.js';

const readTranscript = vi.fn<() => Promise<TimelineEvent[]>>();

vi.mock('@main/conversations/conversationStore.js', () => ({
  readTranscript: (...args: unknown[]) => readTranscript(...args)
}));

import { readLastTodosFromTranscript } from '@main/tasks/taskTranscriptFallback.js';

describe('readLastTodosFromTranscript', () => {
  it('returns the latest todos-update snapshot', async () => {
    readTranscript.mockResolvedValueOnce([
      {
        kind: 'todos-update',
        id: 'a',
        ts: 1,
        conversationId: 'conv-1',
        items: [{ id: '1', content: 'old', status: 'completed' }]
      },
      {
        kind: 'todos-update',
        id: 'b',
        ts: 2,
        conversationId: 'conv-1',
        items: [{ id: '2', content: 'new', status: 'in_progress' }]
      }
    ]);

    const items = await readLastTodosFromTranscript('conv-1');
    expect(items).toEqual([{ id: '2', content: 'new', status: 'in_progress' }]);
  });

  it('returns an empty list when no todos-update events exist', async () => {
    readTranscript.mockResolvedValueOnce([
      { kind: 'user-prompt', id: 'u', ts: 1, prompt: 'hi' } as TimelineEvent
    ]);
    await expect(readLastTodosFromTranscript('conv-1')).resolves.toEqual([]);
  });
});
