/**
 * Shared selectable row chrome for preset options and custom answers.
 */

import type { ReactNode } from 'react';
import { cn } from '../../../lib/cn.js';

interface AskUserOptionButtonProps {
  selected: boolean;
  allowMultiple: boolean;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
  as?: 'button' | 'label';
  htmlFor?: string;
}

export function AskUserOptionButton({
  selected,
  allowMultiple,
  onClick,
  children,
  className,
  as = 'button',
  htmlFor
}: AskUserOptionButtonProps) {
  const shared = cn(
    'vx-ask-user-option flex w-full items-start gap-2 rounded-inner border px-2.5 py-1.5 text-left text-row transition-colors',
    selected
      ? 'border-accent/50 bg-accent-soft/30 text-text-primary'
      : 'border-border-subtle/50 bg-chrome-hover-soft/15 text-text-secondary hover:border-border-subtle hover:bg-chrome-hover-soft/25',
    className
  );

  const indicator = (
    <span
      className={cn(
        'mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center border font-mono text-meta',
        allowMultiple ? 'rounded-sm' : 'rounded-full',
        selected
          ? 'border-accent bg-accent text-text-primary'
          : 'border-border-subtle text-transparent'
      )}
      aria-hidden
    >
      {allowMultiple ? '✓' : '•'}
    </span>
  );

  if (as === 'label') {
    return (
      <label htmlFor={htmlFor} className={cn(shared, 'cursor-text')}>
        {indicator}
        <span className="min-w-0 flex-1">{children}</span>
      </label>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={shared}
      aria-pressed={selected}
    >
      {indicator}
      <span className="min-w-0 flex-1">{children}</span>
    </button>
  );
}
