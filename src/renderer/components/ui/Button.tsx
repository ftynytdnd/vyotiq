/**
 * Button — primary action affordance shared across modals, settings,
 * and inline panels.
 *
 * Variants:
 *   - `primary`   — filled accent CTA. Hover deepens to `accent-strong`.
 *   - `secondary` — neutral surface, hover lifts to `surface-hover`.
 *   - `ghost`     — transparent, hover-only background.
 *   - `danger`    — destructive ghost (red text on transparent, hover
 *     paints `bg-danger/10`). Used by destructive icon buttons. Filled
 *     destructive emphasis is achieved by composing this variant with
 *     a `confirm` step (see `ConfirmDialog`) rather than inventing a
 *     separate filled-red variant — that keeps the visual register
 *     calm even when the action is destructive.
 *
 * Sizes follow the rest of the renderer's height rhythm:
 *   - `sm` — 28px / `text-row` (paired with `text-meta` on icons).
 *   - `md` — 36px / `text-body`.
 *
 * `loading` collapses the button into a busy state: pointer events
 * suppressed, native `disabled` flipped, and a left-rail `Spinner`
 * replaces the leading icon (the caller's children render after).
 * Eliminates the repeated `{busy ? <Spinner /> : <Icon />}` pattern
 * that had drifted across `TriggerBar`, `ProvidersPanel`, etc. The
 * Spinner reuses the existing `Spinner` primitive so the size,
 * stroke, and animation match every other loading surface.
 *
 * Focus: relies on the global `:focus-visible` halo declared in
 * `index.css` — no per-variant ring utilities so the halo never
 * double-paints. `app-no-drag` keeps the button clickable inside
 * the frameless title bar's drag region.
 */
import React from 'react';
import { cn } from '../../lib/cn.js';
import { Spinner } from './Spinner.js';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /**
   * When true, the button is non-interactive and renders a leading
   * spinner. The native `disabled` attribute is flipped so screen
   * readers and keyboard users cannot trigger the action either.
   * Pair with an `aria-label` describing the in-flight operation
   * when the button's text alone wouldn't make the busy state clear.
   */
  loading?: boolean;
}

const variantClasses: Record<Variant, string> = {
  primary: 'bg-accent text-surface-base hover:bg-accent-strong',
  secondary: 'bg-surface-raised text-text-primary hover:bg-surface-hover',
  ghost: 'bg-transparent text-text-secondary hover:bg-surface-hover hover:text-text-primary',
  danger: 'bg-transparent text-danger hover:bg-danger/10'
};

const sizeClasses: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-row',
  md: 'h-9 px-3.5 text-body'
};

const SPINNER_SIZE: Record<Size, number> = {
  sm: 12,
  md: 14
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', className, children, loading, disabled, ...rest },
  ref
) {
  const isDisabled = disabled || loading;
  return (
    <button
      ref={ref}
      type="button"
      aria-busy={loading || undefined}
      disabled={isDisabled}
      className={cn(
        'app-no-drag inline-flex items-center justify-center gap-1.5 rounded-inner font-medium',
        'transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50',
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      {...rest}
    >
      {loading && <Spinner size={SPINNER_SIZE[size]} className="text-current" />}
      {children}
    </button>
  );
});
