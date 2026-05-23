/**
 * Muted hint surfaced above the textarea when one or more conversations
 * other than the active one are streaming. Lets the user know that
 * background work is in progress without forcing them to expand the
 * dock to find out.
 *
 *   "2 chats streaming elsewhere · Show"
 *
 * Hidden entirely when there are zero background runs — no chrome ever
 * paints in the idle state.
 *
 * "Show" expands the bottom dock (if collapsed) and scrolls the first
 * running chat tab into view via `focusRow`. Tabs register refs through
 * `useChatRowFocus` in `DockChatStrip`.
 *
 * Visual rhythm reuses existing tokens (`text-row text-text-muted`,
 * `app-no-drag`, `transition-colors`) — no new surfaces, no card
 * chrome, no new design tokens.
 */

import { cn } from '../../../lib/cn.js';
import { useBackgroundRuns } from '../../../hooks/chat/index.js';
import { focusRow } from '../../../hooks/chat/useChatRowFocus.js';

export function RunningElsewhereHint({ className }: { className?: string }) {
  const { count, firstRunningId } = useBackgroundRuns();
  if (count === 0) return null;
  const label =
    count === 1
      ? '1 chat streaming elsewhere'
      : `${count} chats streaming elsewhere`;
  return (
    <div className={cn('flex min-w-0 items-center gap-1.5 self-start text-row text-text-muted', className)}>
      <span className="truncate">{label}</span>
      <span aria-hidden="true">·</span>
      <button
        type="button"
        onClick={() => {
          if (firstRunningId) focusRow(firstRunningId);
        }}
        disabled={!firstRunningId}
        className={cn(
          'app-no-drag rounded-inner text-text-secondary',
          'transition-colors duration-150',
          'hover:text-text-primary focus-visible:text-text-primary focus-visible:outline-none',
          'disabled:cursor-not-allowed disabled:text-text-faint'
        )}
      >
        Show
      </button>
    </div>
  );
}
