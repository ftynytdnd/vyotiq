/**
 * Shared dock chat filter — workspace scope, optional search query,
 * running-id bypass, and always-visible active tab.
 */

import type { ConversationMeta } from '@shared/types/chat.js';

export function filterDockChats(
  list: readonly ConversationMeta[],
  workspaceId: string,
  query: string,
  searchOpen: boolean,
  runningIds: ReadonlySet<string>,
  activeId?: string | null
): ConversationMeta[] {
  const q = query.trim().toLowerCase();
  const isFiltering = searchOpen && q.length > 0;

  return list.filter((c) => {
    if (c.workspaceId !== workspaceId) return false;
    if (c.id === activeId) return true;
    if (isFiltering && !c.title.toLowerCase().includes(q) && !runningIds.has(c.id)) {
      return false;
    }
    return true;
  });
}
