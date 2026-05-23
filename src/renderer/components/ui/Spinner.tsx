/**
 * Spinner — minimal 12px-default loading indicator. Used inline next
 * to row-sized labels (`text-row` / `text-meta`), inside `Button`'s
 * `loading` slot, and in the empty-state hints across Settings,
 * the Inspector, and the dock.
 *
 * The default size was tightened from 14 → 12 because every recent
 * caller passed `size={12}` to match the surrounding `text-row`
 * cap-height. Callers that need a larger spinner for hero-style
 * empty states can still pass `size={14}` or `size={16}` explicitly.
 *
 * Color follows the surrounding text — defaults to `text-text-muted`
 * but inherits via `text-current` when the parent passes a color
 * class through `className` (used by `Button` so the spinner picks
 * up the variant's foreground tone automatically).
 */
import { cn } from '../../lib/cn.js';

interface SpinnerProps {
  className?: string;
  size?: number;
}

export function Spinner({ className, size = 12 }: SpinnerProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={cn('animate-spin text-text-muted', className)}
      role="status"
      aria-label="Loading"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
        opacity="0.25"
        fill="none"
      />
      <path fill="currentColor" d="M4 12a8 8 0 0 1 8-8v3a5 5 0 0 0-5 5H4z" />
    </svg>
  );
}
