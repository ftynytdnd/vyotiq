import type { ConversationMeta } from '../types/chat.js';

/** Pinned chats first, preserving pin-list order, then the original list order. */
export function sortDockChatsByPins(
  entries: readonly ConversationMeta[],
  pinnedIds: readonly string[] | undefined
): ConversationMeta[] {
  if (!pinnedIds?.length) return [...entries];
  const pinOrder = new Map(pinnedIds.map((id, index) => [id, index]));
  const pinned: ConversationMeta[] = [];
  const rest: ConversationMeta[] = [];
  for (const entry of entries) {
    if (pinOrder.has(entry.id)) pinned.push(entry);
    else rest.push(entry);
  }
  pinned.sort((a, b) => (pinOrder.get(a.id) ?? 0) - (pinOrder.get(b.id) ?? 0));
  return [...pinned, ...rest];
}

export function isConversationPinned(
  conversationId: string,
  pinnedIds: readonly string[] | undefined
): boolean {
  return pinnedIds?.includes(conversationId) === true;
}

export function togglePinnedConversationId(
  pinnedIds: readonly string[] | undefined,
  conversationId: string
): string[] {
  const current = pinnedIds ? [...pinnedIds] : [];
  const index = current.indexOf(conversationId);
  if (index >= 0) {
    current.splice(index, 1);
    return current;
  }
  return [conversationId, ...current];
}

export function prunePinnedConversationIds(
  pinnedIds: readonly string[] | undefined,
  removedId: string
): string[] | undefined {
  if (!pinnedIds?.length) return pinnedIds ? [...pinnedIds] : undefined;
  const next = pinnedIds.filter((id) => id !== removedId);
  return next.length === pinnedIds.length ? [...pinnedIds] : [...next];
}
