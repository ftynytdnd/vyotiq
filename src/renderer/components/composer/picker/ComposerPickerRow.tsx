/**
 * Shared row chrome for composer typeahead pickers.
 */

import type { ReactNode } from 'react';
import { cn } from '../../../lib/cn.js';

export type ComposerPickerBadgeTone = 'command' | 'manual';

export function ComposerPickerBadge({
  tone,
  children
}: {
  tone: ComposerPickerBadgeTone;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'vx-composer-picker-badge',
        tone === 'command' && 'vx-composer-picker-badge--command',
        tone === 'manual' && 'vx-composer-picker-badge--manual'
      )}
    >
      {children}
    </span>
  );
}

export interface ComposerPickerRowProps {
  rowId: string;
  active: boolean;
  disabled?: boolean;
  ariaLabel: string;
  title?: string;
  /** `inline` — icon + truncate lines (@ mentions). `stacked` — title row + clamped description (skills). */
  layout?: 'inline' | 'stacked';
  icon?: ReactNode;
  primary: ReactNode;
  description?: ReactNode;
  badges?: ReactNode;
  trailing?: ReactNode;
  paddingLeft?: number;
  onMouseEnter?: () => void;
  onClick: () => void;
}

export function ComposerPickerRow({
  rowId,
  active,
  disabled,
  ariaLabel,
  title,
  layout = 'inline',
  icon,
  primary,
  description,
  badges,
  trailing,
  paddingLeft,
  onMouseEnter,
  onClick
}: ComposerPickerRowProps) {
  const stacked = layout === 'stacked';

  return (
    <button
      type="button"
      role="option"
      id={active ? `composer-picker-row-${rowId}` : undefined}
      aria-selected={active}
      aria-disabled={disabled || undefined}
      aria-label={ariaLabel}
      data-composer-picker-row={rowId}
      title={title}
      disabled={disabled}
      className={cn(
        'vx-mention-picker-row vx-composer-picker-row vx-dropdown-item flex w-full gap-2 rounded-md text-left',
        stacked ? 'items-start px-2 py-1.5' : 'items-center py-1 pr-2',
        active && 'bg-dock-selection',
        disabled && 'cursor-not-allowed opacity-50'
      )}
      style={paddingLeft != null ? { paddingLeft: `${paddingLeft}px` } : undefined}
      onMouseEnter={onMouseEnter}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        if (disabled) return;
        onClick();
      }}
    >
      {icon ? <span className="shrink-0 text-text-faint">{icon}</span> : null}
      <span className="min-w-0 flex-1">
        {stacked ? (
          <>
            <span className="vx-composer-picker-title flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
              <span
                className={cn(
                  'vx-composer-picker-name font-mono text-row min-w-0',
                  active ? 'text-text-primary' : 'text-text-secondary'
                )}
              >
                {primary}
              </span>
              {badges}
            </span>
            {description ? (
              <span
                className={cn(
                  'vx-composer-picker-desc mt-0.5 block text-meta',
                  active ? 'text-text-muted' : 'text-text-faint'
                )}
              >
                {description}
              </span>
            ) : null}
          </>
        ) : (
          <>
            <span
              className={cn(
                'block truncate text-row text-text-secondary',
                active && 'text-text-primary'
              )}
            >
              {primary}
            </span>
            {description ? (
              <span className="block truncate font-mono text-meta text-text-faint">{description}</span>
            ) : null}
          </>
        )}
      </span>
      {trailing ? (
        <span className="shrink-0 font-mono text-meta text-text-faint">{trailing}</span>
      ) : null}
    </button>
  );
}
