/**
 * Switch — iOS-style pill toggle. Captures the visual + a11y shape that
 * the composer's PermissionsMenu already used, and surfaces it as a
 * shared primitive so any boolean preference in the app renders the
 * same control regardless of where it lives.
 *
 * Two sizes track the renderer's existing height rhythm:
 *   - `sm` — 16×28 (h-4 w-7) pill, 12×12 (h-3 w-3) thumb. Compact
 *     popover rows (PermissionsMenu, future overflow menus).
 *   - `md` — 20×36 (h-5 w-9) pill, 16×16 (h-4 w-4) thumb. Settings
 *     panel rows where the toggle sits beside a paragraph of help
 *     text and the control needs more visual weight.
 *
 * Two layout modes, chosen by whether `label` is supplied:
 *   - **Standalone pill** (no `label`): the rendered `<button>` is
 *     just the pill + thumb. Callers wrap with their own row
 *     layout (label-description-on-left, switch-on-right is the
 *     Settings-tab rhythm).
 *   - **Inline row** (with `label`): the rendered `<button>` is the
 *     ENTIRE row — label text on the left, pill on the right,
 *     hover-affordance on the whole surface. The single button
 *     element keeps WAI-ARIA semantics and "click anywhere on the
 *     row" UX in one click target without nesting interactive
 *     elements (which would be invalid HTML). The PermissionsMenu
 *     and any future popover row uses this mode.
 *
 * Colors come from the existing token palette — `bg-accent` for on,
 * `bg-border-strong` for off, `bg-surface-base` for the thumb so it
 * always reads against the pill regardless of state. The 150 ms
 * transition on `bg-{state}` + `left-{state}` matches every other
 * hover transition in the renderer.
 *
 * Accessibility:
 *   - `role="switch"` and `aria-checked={value}` per the WAI-ARIA
 *     pattern for switches.
 *   - In inline-row mode the visible label text doubles as the
 *     accessible name; `ariaLabel` is still honored for callers
 *     that want to disambiguate (e.g. "Allow file writes" vs
 *     "File writes" terse label).
 *   - In standalone mode callers MUST supply `ariaLabel` (or wire
 *     `aria-labelledby` on the parent row).
 *   - The button picks up the global `:focus-visible` halo declared
 *     in `index.css`, so keyboard users get a clear focus ring
 *     without this primitive needing to reinvent it.
 *   - `app-no-drag` ensures the switch stays clickable inside the
 *     frameless title bar's drag region (defensive — no current
 *     caller lives there, but future ones might).
 */

import React from 'react';
import { cn } from '../../lib/cn.js';

type SwitchSize = 'sm' | 'md';

interface SwitchProps {
  value: boolean;
  onChange: (next: boolean) => void;
  size?: SwitchSize;
  /**
   * User-visible label for the switch. When provided the button
   * renders as an inline row (label-left, pill-right). When omitted
   * the button renders as just the pill — callers position it
   * inside their own row layout.
   */
  label?: React.ReactNode;
  /**
   * Forwarded to the rendered `<button>`'s `aria-label`. Optional
   * in inline-row mode (the visible label provides the accessible
   * name); required in standalone mode unless the parent row wires
   * `aria-labelledby` externally.
   */
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
  /** Optional id forwarded onto the button — useful for `htmlFor`
   *  wiring from external labels. */
  id?: string;
}

interface SwitchSizing {
  pill: string;
  thumb: string;
  /** Left offset when `value === false`. */
  offLeft: string;
  /** Left offset when `value === true`. Computed so the thumb sits
   *  flush with the inside-right edge of the pill, mirroring the
   *  inset on the off state. */
  onLeft: string;
  /** Top offset for the thumb — same insets on every size. */
  thumbTop: string;
}

const SIZING: Record<SwitchSize, SwitchSizing> = {
  // 28×16 pill, 12×12 thumb, 2px padding all around → thumb travels
  // 12px (left-0.5 ↔ left-3.5). Byte-identical to the legacy
  // PermissionsMenu toggle so that migration is a no-op visually.
  sm: {
    pill: 'h-4 w-7',
    thumb: 'h-3 w-3',
    offLeft: 'left-0.5',
    onLeft: 'left-3.5',
    thumbTop: 'top-0.5'
  },
  // 36×20 pill, 16×16 thumb, 2px padding all around → thumb travels
  // 16px (left-0.5 ↔ left-[18px]). Slightly larger control for
  // Settings-tab rows where the toggle sits beside a paragraph of
  // help text.
  md: {
    pill: 'h-5 w-9',
    thumb: 'h-4 w-4',
    offLeft: 'left-0.5',
    onLeft: 'left-[18px]',
    thumbTop: 'top-0.5'
  }
};

function SwitchPill({
  size,
  value
}: {
  size: SwitchSize;
  value: boolean;
}) {
  const sizing = SIZING[size];
  return (
    <span
      aria-hidden
      className={cn(
        'relative inline-flex shrink-0 items-center rounded-full',
        'transition-colors duration-150',
        sizing.pill,
        value ? 'bg-accent' : 'bg-border-strong'
      )}
    >
      <span
        className={cn(
          'absolute rounded-full bg-surface-base transition-all duration-150',
          sizing.thumb,
          sizing.thumbTop,
          value ? sizing.onLeft : sizing.offLeft
        )}
      />
    </span>
  );
}

export function Switch({
  value,
  onChange,
  size = 'sm',
  label,
  ariaLabel,
  disabled,
  className,
  id
}: SwitchProps) {
  const handleClick = () => {
    if (disabled) return;
    onChange(!value);
  };

  const commonButtonProps: React.ButtonHTMLAttributes<HTMLButtonElement> = {
    type: 'button',
    role: 'switch',
    'aria-checked': value,
    disabled,
    onClick: handleClick,
    ...(id ? { id } : {}),
    ...(ariaLabel ? { 'aria-label': ariaLabel } : {})
  };

  // Inline-row mode: label on the left, pill on the right, the
  // whole `<button>` is the click target. Hover lifts the row to
  // `bg-surface-hover` so a long label still gets visible
  // affordance.
  if (label !== undefined) {
    return (
      <button
        {...commonButtonProps}
        className={cn(
          'app-no-drag flex w-full items-center justify-between rounded-inner px-2 py-1.5',
          'text-row text-text-secondary transition-colors duration-150',
          'hover:bg-surface-hover',
          disabled && 'cursor-not-allowed opacity-50',
          className
        )}
      >
        <span className="min-w-0 truncate">{label}</span>
        <SwitchPill size={size} value={value} />
      </button>
    );
  }

  // Standalone-pill mode: just the pill + thumb. Caller controls
  // surrounding layout (label / description / row chrome).
  const sizing = SIZING[size];
  return (
    <button
      {...commonButtonProps}
      className={cn(
        'app-no-drag relative inline-flex shrink-0 items-center rounded-full',
        'transition-colors duration-150',
        sizing.pill,
        value ? 'bg-accent' : 'bg-border-strong',
        disabled && 'cursor-not-allowed opacity-50',
        className
      )}
    >
      <span
        aria-hidden
        className={cn(
          'absolute rounded-full bg-surface-base transition-all duration-150',
          sizing.thumb,
          sizing.thumbTop,
          value ? sizing.onLeft : sizing.offLeft
        )}
      />
    </button>
  );
}
