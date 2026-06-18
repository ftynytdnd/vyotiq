import { describe, expect, it } from 'vitest';
import type { ConversationMeta } from '@shared/types/chat.js';
import {
  isConversationSlotValid,
  mostRecentConversationForWorkspace,
  resolveWorkspaceConversationTarget
} from '@renderer/store/useConversationsStore';

function meta(
  partial: Partial<ConversationMeta> & Pick<ConversationMeta, 'id' | 'workspaceId'>
): ConversationMeta {
  return {
    title: 'T',
    createdAt: 0,
    updatedAt: 0,
    eventCount: 1,
    ...partial
  };
}

describe('conversation slot resolve helpers', () => {
  const list = [
    meta({ id: 'c1', workspaceId: 'ws-1', updatedAt: 10 }),
    meta({ id: 'c2', workspaceId: 'ws-1', updatedAt: 50 }),
    meta({ id: 'c3', workspaceId: 'ws-2', updatedAt: 100 }),
    meta({ id: 'c-arch', workspaceId: 'ws-1', updatedAt: 200, archived: true }),
    meta({ id: 'c-ghost', workspaceId: 'ws-1', updatedAt: 300, eventCount: 0 })
  ];

  it('isConversationSlotValid rejects archived and cross-workspace rows but keeps fresh empty chats', () => {
    expect(isConversationSlotValid(list, 'ws-1', 'c2')).toBe(true);
    expect(isConversationSlotValid(list, 'ws-1', 'c-ghost')).toBe(true);
    expect(isConversationSlotValid(list, 'ws-1', 'c-arch')).toBe(false);
    expect(isConversationSlotValid(list, 'ws-1', 'c3')).toBe(false);
    expect(isConversationSlotValid(list, 'ws-1', 'missing')).toBe(false);
  });

  it('mostRecentConversationForWorkspace ignores archived and ghost chats', () => {
    expect(mostRecentConversationForWorkspace(list, 'ws-1')?.id).toBe('c2');
    expect(mostRecentConversationForWorkspace(list, 'ws-2')?.id).toBe('c3');
    expect(mostRecentConversationForWorkspace(list, 'ws-empty')).toBeNull();
  });

  it('resolveWorkspaceConversationTarget keeps a valid slot', () => {
    expect(resolveWorkspaceConversationTarget(list, 'ws-1', 'c1')).toBe('c1');
  });

  it('resolveWorkspaceConversationTarget keeps a fresh empty chat in the slot', () => {
    expect(resolveWorkspaceConversationTarget(list, 'ws-1', 'c-ghost')).toBe('c-ghost');
  });

  it('resolveWorkspaceConversationTarget falls back to newest when slot is stale', () => {
    expect(resolveWorkspaceConversationTarget(list, 'ws-1', 'gone')).toBe('c2');
    expect(resolveWorkspaceConversationTarget(list, 'ws-1', 'c-arch')).toBe('c2');
    expect(resolveWorkspaceConversationTarget(list, 'ws-1', null)).toBe('c2');
  });

  it('resolveWorkspaceConversationTarget honors a ghost slot but falls back to null when unset', () => {
    const ghosts = [
      meta({ id: 'g1', workspaceId: 'ws-1', updatedAt: 1, eventCount: 0 }),
      meta({ id: 'g2', workspaceId: 'ws-1', updatedAt: 2, eventCount: 0 })
    ];
    expect(resolveWorkspaceConversationTarget(ghosts, 'ws-1', 'g2')).toBe('g2');
    expect(resolveWorkspaceConversationTarget(ghosts, 'ws-1', null)).toBeNull();
  });
});
