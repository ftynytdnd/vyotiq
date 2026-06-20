import { describe, expect, it } from 'vitest';
import { countWorkspaceChats } from '@renderer/components/dock/countWorkspaceChats';

describe('countWorkspaceChats', () => {
  it('counts non-archived chats for a workspace', () => {
    const list = [
      { id: 'a', workspaceId: 'ws-1', archived: false },
      { id: 'b', workspaceId: 'ws-1', archived: true },
      { id: 'c', workspaceId: 'ws-2', archived: false }
    ] as never[];
    expect(countWorkspaceChats(list, 'ws-1')).toBe(1);
    expect(countWorkspaceChats(list, 'ws-2')).toBe(1);
    expect(countWorkspaceChats(list, 'ws-missing')).toBe(0);
  });
});
