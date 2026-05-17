/**
 * Chip — small, stealth-dark, pill-shaped surface used for inline tokens
 * inside the composer (workspace context, model id, attachment), the
 * sub-agent header (file chips), preset rows in `AddProviderForm`, and
 * any future micro-pill callers.
 *
 * Two render modes:
 *   - static  (`as` omitted or `'span'`): non-interactive `<span>`. The
 *     parent's flex layout handles wrapping; callers append `self-start`
 *     / `min-w-0` via `className` when their parent needs them.
 *   - button (`as: 'button'`): interactive `<button>` with the standard
 *     150 ms color transition and hover pair (`bg-surface-hover` /
 *     `text-text-primary`). `app-no-drag` is included so the chip
 *     remains clickable inside the frameless title bar's drag region.
 *
 * Tones map to the existing text tokens — no new colors, no new opacity
 * literals, no new radii. Optional `pressed` flips the chip into a
 * "selected/active" state by promoting the resting tint to
 * `bg-surface-hover text-text-primary` so toggle-style chip rows
 * (model preset selection, status filters) read correctly without
 * the caller hand-rolling the active class string. `disabled` mutes
 * the chip and suppresses pointer events.
 */

import React from 'react';
import { cn } from '../../lib/cn.js';

type ChipTone = 'faint' | 'muted' | 'secondary';

const TONE_CLASS: Record<ChipTone, string> = {
  faint: 'text-text-faint',
  muted: 'text-text-muted',
  secondary: 'text-text-secondary'
};

interface ChipBase {
  tone?: ChipTone;
  className?: string;
  title?: string;
  children: React.ReactNode;
}

interface StaticChipProps extends ChipBase {
  as?: 'span';
}

interface InteractiveChipProps extends ChipBase {
  as: 'button';
  onClick: () => void;
  /**
   * Forwarded to the rendered `<button>`'s `aria-label` attribute.
   * When omitted, screen readers fall back to the chip's text content.
   */
  ariaLabel?: string;
  /**
   * Selected/active visual state. Promotes the chip to
   * `bg-surface-hover text-text-primary` and flips
   * `aria-pressed="true"` so toggle rows are accessible without
   * each caller composing the active class by hand.
   */
  pressed?: boolean;
  /** Mutes the chip and disables pointer events. */
  disabled?: boolean;
}

export type ChipProps = StaticChipProps | InteractiveChipProps;

export function Chip(props: ChipProps) {
  const { tone = 'muted', className, title, children } = props;
  const base = cn(
    'inline-flex items-center gap-1 rounded-full bg-surface-overlay px-2 py-0.5 text-meta',
    TONE_CLASS[tone],
    className
  );

  if (props.as === 'button') {
    const { pressed, disabled, onClick, ariaLabel } = props;
    return (
      <button
        type="button"
        onClick={disabled ? undefined : onClick}
        aria-label={ariaLabel}
        aria-pressed={pressed ?? undefined}
        disabled={disabled}
        title={title}
        className={cn(
          base,
          'app-no-drag transition-colors duration-150',
          pressed
            ? 'bg-surface-hover text-text-primary'
            : 'hover:bg-surface-hover hover:text-text-primary',
          disabled && 'cursor-not-allowed opacity-50 hover:bg-surface-overlay hover:text-text-muted'
        )}
      >
        {children}
      </button>
    );
  }
  return (
    <span className={base} title={title}>
      {children}
    </span>
  );
}
