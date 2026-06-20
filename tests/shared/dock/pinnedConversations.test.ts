import { describe, expect, it } from 'vitest';
import type { ConversationMeta } from '@shared/types/chat.js';
import {
  isConversationPinned,
  prunePinnedConversationIds,
  sortDockChatsByPins,
  togglePinnedConversationId
} from '@shared/dock/pinnedConversations.js';

function chat(id: string): ConversationMeta {
  return {
    id,
    workspaceId: 'ws',
    title: id,
    createdAt: 0,
    updatedAt: 0,
    eventCount: 0
  };
}

describe('sortDockChatsByPins', () => {
  it('keeps unpinned order when no pins are set', () => {
    const entries = [chat('a'), chat('b')];
    expect(sortDockChatsByPins(entries, undefined).map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('moves pinned chats to the top in pin-list order', () => {
    const entries = [chat('a'), chat('b'), chat('c')];
    expect(sortDockChatsByPins(entries, ['c', 'a']).map((e) => e.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('togglePinnedConversationId', () => {
  it('adds and removes ids', () => {
    expect(togglePinnedConversationId(undefined, 'a')).toEqual(['a']);
    expect(togglePinnedConversationId(['a'], 'a')).toEqual([]);
  });
});

describe('prunePinnedConversationIds', () => {
  it('drops removed ids only when present', () => {
    expect(prunePinnedConversationIds(['a', 'b'], 'b')).toEqual(['a']);
    expect(prunePinnedConversationIds(['a'], 'missing')).toEqual(['a']);
  });
});

describe('isConversationPinned', () => {
  it('reflects membership', () => {
    expect(isConversationPinned('a', ['a', 'b'])).toBe(true);
    expect(isConversationPinned('c', ['a', 'b'])).toBe(false);
  });
});
