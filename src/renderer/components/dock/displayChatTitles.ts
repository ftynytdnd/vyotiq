/**
 * Derive disambiguated display titles for dock chat tabs when multiple
 * conversations share the same auto-derived title (e.g. two "hi" chats).
 * Placeholder titles (`New conversation`) render as "Untitled" in the dock.
 */

import type { ConversationMeta } from '@shared/types/chat.js';

/** Persisted default title before the user sends or the agent names the chat. */
export const PLACEHOLDER_CHAT_TITLE = 'New conversation';

const DOCK_PLACEHOLDER_LABEL = 'Untitled';

export function isPlaceholderChatTitle(title: string): boolean {
  return title.trim().toLowerCase() === PLACEHOLDER_CHAT_TITLE.toLowerCase();
}

function dockDisplayBaseTitle(title: string): string {
  return isPlaceholderChatTitle(title) ? DOCK_PLACEHOLDER_LABEL : title;
}

export function buildDisplayChatTitles(
  entries: ReadonlyArray<ConversationMeta>
): Map<string, string> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const key = dockDisplayBaseTitle(entry.title).toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const seen = new Map<string, number>();
  const result = new Map<string, string>();
  for (const entry of entries) {
    const base = dockDisplayBaseTitle(entry.title);
    const key = base.toLowerCase();
    if ((counts.get(key) ?? 0) <= 1) {
      result.set(entry.id, base);
      continue;
    }
    const index = (seen.get(key) ?? 0) + 1;
    seen.set(key, index);
    result.set(entry.id, `${base} (${index})`);
  }
  return result;
}
