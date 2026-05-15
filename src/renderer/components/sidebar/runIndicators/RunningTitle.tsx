/**
 * Conversation row title that toggles a soft text-gradient sweep
 * (`vyotiq-shimmer-text`) while the conversation's slice is processing.
 *
 * Drop-in replacement for the inline title `<span>` in
 * `ChatHistoryList.tsx`. When the slice is idle the rendered output is
 * byte-identical to the previous `<span title>{title}</span>` — only
 * the active (running) state adds the shimmer utility + per-instance
 * phase offset.
 *
 * Reuses the existing `lib/shimmer.ts` helpers and the
 * `vyotiq-shimmer-text` keyframe declared in `index.css` — no new CSS,
 * no new keyframes, no new tokens.
 */

import { cn } from '../../../lib/cn.js';
import { shimmerStyle, shimmerText } from '../../../lib/shimmer.js';
import { useConversationProcessing } from '../../../hooks/chat/index.js';

interface RunningTitleProps {
  /** Conversation id — drives the slice subscription + the shimmer phase seed. */
  id: string;
  /** Display title. */
  title: string;
  /** Optional extra classes (color, truncation, etc.) composed onto the span. */
  className?: string;
}

export function RunningTitle({ id, title, className }: RunningTitleProps) {
  const { isProcessing } = useConversationProcessing(id);
  return (
    <span
      className={shimmerText(isProcessing, cn('min-w-0 flex-1 truncate', className))}
      style={isProcessing ? shimmerStyle(`conv:${id}`) : undefined}
      title={title}
    >
      {title}
    </span>
  );
}
