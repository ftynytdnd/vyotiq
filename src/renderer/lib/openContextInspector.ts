/**
 * Opens the Context Inspector for the active conversation or live run.
 * Shared by menu items, keyboard shortcuts, and composer affordances.
 */

import { useChatStore } from '../store/useChatStore.js';
import { useSecondaryZoneStore } from '../store/useSecondaryZoneStore.js';

/** Returns false when no conversation is active to inspect. */
export function openContextInspectorForActiveChat(): boolean {
  const chat = useChatStore.getState();
  const id = chat.runId ?? chat.conversationId;
  if (!id) return false;
  useSecondaryZoneStore
    .getState()
    .openInspector(id, chat.runId ? 'live' : 'idle');
  return true;
}
