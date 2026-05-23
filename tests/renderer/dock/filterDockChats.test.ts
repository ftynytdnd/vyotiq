import { describe, expect, it } from 'vitest';
import { filterDockChats } from '@renderer/components/dock/filterDockChats';
import type { ConversationMeta } from '@shared/types/chat';

const meta = (id: string, title: string, workspaceId = 'ws-1'): ConversationMeta => ({
  id,
  title,
  workspaceId,
  createdAt: 0,
  updatedAt: 0,
  eventCount: 0
});

describe('filterDockChats', () => {
  const list = [
    meta('c1', 'Alpha task'),
    meta('c2', 'Beta triage'),
    meta('c3', 'Other workspace', 'ws-2')
  ];

  it('scopes to workspace', () => {
    const result = filterDockChats(list, 'ws-1', '', false, new Set(), null);
    expect(result.map((c) => c.id)).toEqual(['c1', 'c2']);
  });

  it('filters by query but keeps running chats', () => {
    const running = new Set(['c1']);
    const result = filterDockChats(list, 'ws-1', 'beta', true, running, null);
    expect(result.map((c) => c.id)).toEqual(['c1', 'c2']);
  });

  it('always includes the active chat even when it does not match', () => {
    const result = filterDockChats(list, 'ws-1', 'zzz', true, new Set(), 'c1');
    expect(result.map((c) => c.id)).toEqual(['c1']);
  });
});
