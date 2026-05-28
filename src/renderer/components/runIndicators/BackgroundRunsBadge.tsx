/**
 * BackgroundRunsBadge — quiet "N runs in other chats" affordance.
 *
 * Surfaces sibling conversations that are still streaming while the
 * user looks at this one. Clicking jumps the dock chat strip to the
 * first such conversation; the user can then `Alt+↑/↓` between them.
 *
 * Hidden when no sibling run is in flight so the composer footer stays
 * uncluttered during single-conversation work. Live-region polite so
 * screen readers announce the change without interrupting.
 */

import { useBackgroundRuns } from '../../hooks/chat/useBackgroundRuns.js';
import { useConversationsStore } from '../../store/useConversationsStore.js';
import { cn } from '../../lib/cn.js';

export function BackgroundRunsBadge() {
  const { count, firstRunningId } = useBackgroundRuns();
  const select = useConversationsStore((s) => s.select);

  if (count === 0) return null;

  const label = count === 1 ? '1 run elsewhere' : `${count} runs elsewhere`;
  const title =
    count === 1
      ? '1 conversation is still streaming. Click to jump to it.'
      : `${count} conversations are still streaming. Click to jump to the first.`;

  const onClick = (): void => {
    if (firstRunningId) void select(firstRunningId);
  };

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-live="polite"
      className={cn(
        'app-no-drag vx-btn vx-btn-quiet inline-flex h-5 shrink-0 items-center gap-1 px-1.5 text-meta',
        'tabular-nums text-text-muted hover:text-text-secondary'
      )}
    >
      <span
        aria-hidden
        className="inline-block h-1.5 w-1.5 rounded-full bg-accent vyotiq-shimmer-pulse"
      />
      <span>{label}</span>
    </button>
  );
}
