/**
 * Chat-store-derived selector hooks. Each hook subscribes with a
 * shallow comparator so unrelated slice mutations never re-render the
 * consumer — important for the multi-session UI where many slices
 * stream concurrently.
 */

export { useConversationProcessing } from './useConversationProcessing.js';
export { useWorkspaceHasActiveRun } from './useWorkspaceHasActiveRun.js';
export { useChatRowFocus } from './useChatRowFocus.js';
