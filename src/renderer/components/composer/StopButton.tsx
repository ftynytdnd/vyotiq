/**
 * StopButton — abort in-flight run; quiet chrome so Send stays the accent CTA.
 */

import { Square } from 'lucide-react';
import { cn } from '../../lib/cn.js';
import { SHELL_MICRO_ICON_CLASS, SHELL_MICRO_ICON_STROKE } from '../../lib/shellIcons.js';

interface StopButtonProps {
  onClick: () => void;
  className?: string;
}

export function StopButton({ onClick, className }: StopButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Stop"
      title="Stop"
      className={cn(
        'vx-btn vx-btn-quiet app-no-drag h-6 w-6 shrink-0 px-0 text-text-muted hover:text-danger',
        className
      )}
    >
      <Square className={cn(SHELL_MICRO_ICON_CLASS, 'fill-current')} strokeWidth={SHELL_MICRO_ICON_STROKE} />
    </button>
  );
}
