import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTasksStore } from '@renderer/store/useTasksStore';
import type { TaskItem } from '@shared/types/task';

const sample: TaskItem[] = [
  { id: '1', content: 'Ship feature', status: 'pending' },
  { id: '2', content: 'Write tests', status: 'in_progress' }
];

describe('useTasksStore', () => {
  beforeEach(() => {
    useTasksStore.setState({ byConversation: {}, hydrateGeneration: {} });
    window.vyotiq.tasks.get = vi.fn(async (conversationId: string) => ({
      conversationId,
      items: sample,
      updatedAt: 1
    })) as never;
    window.vyotiq.tasks.set = vi.fn(async (conversationId: string, items: TaskItem[]) => ({
      conversationId,
      items,
      updatedAt: 2
    })) as never;
  });

  it('hydrates tasks for a conversation', async () => {
    await useTasksStore.getState().hydrate('c1');
    expect(window.vyotiq.tasks.get).toHaveBeenCalledWith('c1');
    expect(useTasksStore.getState().byConversation.c1).toEqual(sample);
  });

  it('drops stale hydrate responses when generation advances', async () => {
    let resolveGet: (value: { conversationId: string; items: TaskItem[]; updatedAt: number }) => void;
    window.vyotiq.tasks.get = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveGet = resolve;
        })
    ) as never;

    const hydratePromise = useTasksStore.getState().hydrate('c1');
    useTasksStore.getState().applyUpdate('c1', [{ id: 'x', content: 'newer', status: 'pending' }]);

    resolveGet!({ conversationId: 'c1', items: sample, updatedAt: 1 });
    await hydratePromise;

    expect(useTasksStore.getState().byConversation.c1).toEqual([
      { id: 'x', content: 'newer', status: 'pending' }
    ]);
  });

  it('rolls back optimistic setTasks when IPC fails', async () => {
    useTasksStore.setState({ byConversation: { c1: sample } });
    window.vyotiq.tasks.set = vi.fn(async () => {
      throw new Error('persist failed');
    }) as never;

    const next = [{ id: '1', content: 'edited', status: 'completed' as const }];
    await useTasksStore.getState().setTasks('c1', next);

    expect(useTasksStore.getState().byConversation.c1).toEqual(sample);
  });

  it('prunes cached tasks when a conversation is removed', () => {
    useTasksStore.setState({
      byConversation: { c1: sample, c2: [] },
      hydrateGeneration: { c1: 1, c2: 2 }
    });

    useTasksStore.getState().pruneConversation('c1');

    expect(useTasksStore.getState().byConversation).toEqual({ c2: [] });
    expect(useTasksStore.getState().hydrateGeneration).toEqual({ c2: 2 });
  });
});
