/**
 * Derive disambiguated display titles for dock chat tabs when multiple
 * conversations share the same auto-derived title (e.g. two "hi" chats).
 */

import type { ConversationMeta } from '@shared/types/chat.js';

export function buildDisplayChatTitles(
  entries: ReadonlyArray<ConversationMeta>
): Map<string, string> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const key = entry.title.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const seen = new Map<string, number>();
  const result = new Map<string, string>();
  for (const entry of entries) {
    const key = entry.title.toLowerCase();
    if ((counts.get(key) ?? 0) <= 1) {
      result.set(entry.id, entry.title);
      continue;
    }
    const index = (seen.get(key) ?? 0) + 1;
    seen.set(key, index);
    result.set(entry.id, `${entry.title} (${index})`);
  }
  return result;
}
