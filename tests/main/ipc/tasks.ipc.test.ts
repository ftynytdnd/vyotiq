/**
 * tasks:get / tasks:set IPC handlers.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcMain } from 'electron';
import { IPC } from '@shared/constants';

interface MockIpcMain {
  __invoke: (channel: string, ...args: unknown[]) => unknown;
  __handlers: Map<string, unknown>;
}

const mockIpc = ipcMain as unknown as MockIpcMain;

const readTaskList = vi.fn(async (conversationId: string) => ({
  conversationId,
  items: [],
  updatedAt: 0
}));
const writeTaskList = vi.fn(
  async (conversationId: string, items: unknown[], merge: boolean) => ({
    conversationId,
    items,
    updatedAt: Date.now(),
    merge
  })
);
const appendEvent = vi.fn(async () => undefined);
const safeWebContentsSend = vi.fn(() => true);

vi.mock('@main/tasks/taskStore.js', () => ({
  readTaskList: (...args: unknown[]) => readTaskList(...args),
  writeTaskList: (...args: unknown[]) => writeTaskList(...args)
}));

vi.mock('@main/conversations/conversationStore.js', () => ({
  appendEvent: (...args: unknown[]) => appendEvent(...args)
}));

vi.mock('@main/window/safeWebContentsSend.js', () => ({
  safeWebContentsSend: (...args: unknown[]) => safeWebContentsSend(...args)
}));

beforeEach(async () => {
  readTaskList.mockClear();
  writeTaskList.mockClear();
  appendEvent.mockClear();
  safeWebContentsSend.mockClear();
  mockIpc.__handlers.clear();
  const { registerTasksIpc } = await import('@main/ipc/tasks.ipc.js');
  registerTasksIpc();
});

describe('tasks IPC', () => {
  it('tasks:get reads the sidecar', async () => {
    readTaskList.mockResolvedValueOnce({
      conversationId: 'conv-1',
      items: [{ id: '1', content: 'one', status: 'pending' }],
      updatedAt: 1
    });
    const list = await mockIpc.__invoke(IPC.TASKS_GET, 'conv-1');
    expect(readTaskList).toHaveBeenCalledWith('conv-1');
    expect(list).toMatchObject({ conversationId: 'conv-1', items: [{ id: '1' }] });
  });

  it('tasks:set writes and emits todos-update', async () => {
    const items = [{ id: '1', content: 'one', status: 'pending' }];
    writeTaskList.mockResolvedValueOnce({
      conversationId: 'conv-1',
      items,
      updatedAt: 2
    });
    const list = await mockIpc.__invoke(IPC.TASKS_SET, 'conv-1', items);
    expect(writeTaskList).toHaveBeenCalledWith('conv-1', items, false);
    expect(list).toMatchObject({ items });
    expect(appendEvent).toHaveBeenCalledTimes(1);
    const event = appendEvent.mock.calls[0]?.[1] as { kind: string; items: unknown[] };
    expect(event.kind).toBe('todos-update');
    expect(event.items).toEqual(items);
    expect(safeWebContentsSend).toHaveBeenCalledWith(
      IPC.CHAT_EVENT,
      'manual:conv-1',
      expect.objectContaining({ kind: 'todos-update', conversationId: 'conv-1' })
    );
  });

  it('tasks:set rejects non-array items', async () => {
    await expect(mockIpc.__invoke(IPC.TASKS_SET, 'conv-1', 'bad')).rejects.toThrow(/array/i);
    expect(writeTaskList).not.toHaveBeenCalled();
  });
});
