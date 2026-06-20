/**
 * Count non-archived chats per workspace for dock folder badges.
 */

import type { ConversationMeta } from '@shared/types/chat.js';

export function countWorkspaceChats(
  list: ReadonlyArray<ConversationMeta>,
  workspaceId: string
): number {
  let count = 0;
  for (const entry of list) {
    if (entry.workspaceId === workspaceId && !entry.archived) count += 1;
  }
  return count;
}
