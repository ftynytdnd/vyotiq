/**
 * Tabs — single-select segmented control / tab strip used across modal
 * surfaces (MemoryPanel, AddProviderForm.DialectSwitch,
 * MemoryPanel.ViewModeToggle).
 *
 * Consolidates six near-duplicate tab patterns that had drifted across
 * the renderer into one shared primitive while preserving every
 * caller's existing visual rhythm. Two render variants:
 *
 *   - **strip** (default): horizontal row of pill buttons. Matches the
 *     `app-no-drag rounded-inner px-2.5 py-1 text-row` shape the
 *     settings tab strip. Active = {@link chromeTabActiveClassName}, idle =
 *     {@link chromeTabIdleClassName}. The
 *     buttons sit FLUSH (no chrome wrapper) so the caller's own
 *     layout (`flex items-center gap-1` etc.) drives positioning.
 *
 *   - **segmented**: inset segmented control. Matches the
 *     `MemoryPanel.ViewModeToggle` pattern (small inset wrapper,
 *     active button gets a raised tint). Used for binary or short
 *     mode toggles (Edit/Preview, OpenAI/Ollama-native dialect).
 *     `size="md"` (default) is the standard form; `size="sm"`
 *     produces the compact `rounded-line px-2 py-0.5 text-row`
 *     rhythm the ViewModeToggle uses.
 *
 * Accessibility:
 *   - Container has `role="tablist"` / `aria-label`.
 *   - Each option is a `role="tab"` button with `aria-selected`.
 *   - `aria-controls` is honored when the caller threads a
 *     `panelId` per item (optional) so screen readers can announce
 *     the controlled panel id.
 *   - Keyboard: ArrowLeft / ArrowRight cycle focus through enabled
 *     tabs; Home / End jump; the focused tab activates immediately
 *     (matches the WAI-ARIA "automatic activation" pattern, which
 *     all current call sites already implement).
 *
 * Design tokens used:
 *   - `chromeTabActiveClassName` / `chromeTabIdleClassName` /
 *     `bg-surface-raised`
 *   - `text-text-primary` / `text-text-muted` / `text-text-secondary`
 *   - `rounded-inner` / `rounded-line`
 *   - `text-row` / `text-meta`
 *   - `transition-colors duration-150`
 *
 * No new tokens, no new dependencies, no new icon library — every
 * existing call site can migrate without visual drift.
 */

import { useRef, type ReactNode } from 'react';
import {
  chromeSegmentedTrayClassName,
  chromeTabActiveClassName,
  chromeTabIdleClassName
} from './SurfaceShell.js';
import { cn } from '../../lib/cn.js';

export interface TabItem<T extends string = string> {
  id: T;
  label: ReactNode;
  /**
   * Optional leading icon. `strip` / `underline` callers pair this with
   * {@link SHELL_TAB_ICON_CLASS} (16×16); `segmented` callers typically omit it. The icon
   * inherits color from the row, so it picks up the active /
   * inactive tone automatically.
   */
  icon?: ReactNode;
  disabled?: boolean;
  /**
   * Optional id of the panel this tab controls. Threaded onto
   * `aria-controls` for screen-reader correctness.
   */
  panelId?: string;
  /** Optional stable id for the tab button (`aria-labelledby` target). */
  tabId?: string;
  /** Overrides the accessible name (avoids clashing with other tablists). */
  ariaLabel?: string;
}

interface TabsProps<T extends string = string> {
  items: ReadonlyArray<TabItem<T>>;
  value: T;
  onChange: (next: T) => void;
  /** Defaults to `'strip'`. `underline` — Vyotiq UI `vx-tab-bar`. */
  variant?: 'strip' | 'segmented' | 'underline';
  /** Only applies to `variant="segmented"`. Defaults to `'md'`. */
  size?: 'sm' | 'md';
  /** Forwarded to the container's `aria-label`. */
  ariaLabel?: string;
  /**
   * Settings-style nav strip: softer base tint (`vx-tab-strip-nav`),
   * active tab uses `vx-tab-pill-active`. Defaults to settings nav strip.
   */
  stripNav?: boolean;
  /**
   * Compact embedded settings rhythm: tighter padding; inactive tabs show
   * icon only (label visible on the active tab). Pair with `stripNav`.
   */
  stripCompact?: boolean;
  /**
   * Underline tabs: always render icon + label (Vyotiq UI tab rhythm).
   * Adds `vx-tab-bar--labeled` so container queries never hide labels.
   */
  alwaysShowLabels?: boolean;
  className?: string;
}

export function Tabs<T extends string = string>({
  items,
  value,
  onChange,
  variant = 'strip',
  size = 'md',
  ariaLabel,
  stripNav = false,
  stripCompact = false,
  alwaysShowLabels = false,
  className
}: TabsProps<T>) {
  const buttonRefs = useRef<Map<T, HTMLButtonElement | null>>(new Map());

  const enabled = items.filter((i) => !i.disabled);

  const focusAt = (id: T) => {
    const el = buttonRefs.current.get(id);
    el?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent, current: T) => {
    if (enabled.length <= 1) return;
    const idx = enabled.findIndex((i) => i.id === current);
    if (idx === -1) return;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const next = enabled[(idx + 1) % enabled.length]!;
      onChange(next.id);
      focusAt(next.id);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const next = enabled[(idx - 1 + enabled.length) % enabled.length]!;
      onChange(next.id);
      focusAt(next.id);
    } else if (e.key === 'Home') {
      e.preventDefault();
      const next = enabled[0]!;
      onChange(next.id);
      focusAt(next.id);
    } else if (e.key === 'End') {
      e.preventDefault();
      const next = enabled[enabled.length - 1]!;
      onChange(next.id);
      focusAt(next.id);
    }
  };

  if (variant === 'underline') {
    const hideInactiveLabels = stripCompact && !alwaysShowLabels;
    return (
      <div
        role="tablist"
        aria-label={ariaLabel}
        className={cn(
          'vx-tab-bar scrollbar-stealth app-no-drag',
          alwaysShowLabels && 'vx-tab-bar--labeled',
          className
        )}
      >
        {items.map((item) => {
          const active = item.id === value;
          const labelText = typeof item.label === 'string' ? item.label : undefined;
          const showLabel = alwaysShowLabels || !stripCompact || active;
          return (
            <button
              key={item.id}
              ref={(el) => {
                buttonRefs.current.set(item.id, el);
              }}
              type="button"
              role="tab"
              id={item.tabId}
              aria-selected={active}
              aria-controls={item.panelId}
              aria-label={hideInactiveLabels && !active ? labelText : undefined}
              title={hideInactiveLabels && !active ? labelText : undefined}
              tabIndex={active ? 0 : -1}
              disabled={item.disabled}
              data-active={active ? 'true' : 'false'}
              onClick={() => !item.disabled && onChange(item.id)}
              onKeyDown={(e) => onKeyDown(e, item.id)}
              className={cn(
                'vx-tab',
                item.disabled && 'cursor-not-allowed opacity-50'
              )}
            >
              {item.icon}
              {showLabel && <span className="vx-tab-label">{item.label}</span>}
            </button>
          );
        })}
      </div>
    );
  }

  if (variant === 'segmented') {
    // Inset segmented control. Wrapper carries the surface
    // (soft tray tint) and the buttons swap active / inactive
    // tints inside. Mirrors the `MemoryPanel.ViewModeToggle` and the
    // `AddProviderForm.DialectSwitch` shape exactly.
    const wrapperClass = chromeSegmentedTrayClassName(size === 'sm');
    return (
      <div
        role="tablist"
        aria-label={ariaLabel}
        className={cn(wrapperClass, className)}
      >
        {items.map((item) => {
          const active = item.id === value;
          return (
            <button
              key={item.id}
              ref={(el) => {
                buttonRefs.current.set(item.id, el);
              }}
              type="button"
              role="tab"
              id={item.tabId}
              aria-selected={active}
              aria-controls={item.panelId}
              aria-label={item.ariaLabel}
              tabIndex={active ? 0 : -1}
              disabled={item.disabled}
              data-active={active ? 'true' : 'false'}
              onClick={() => !item.disabled && onChange(item.id)}
              onKeyDown={(e) => onKeyDown(e, item.id)}
              className={cn(
                'vx-segment-item app-no-drag',
                size === 'md' && 'flex-1',
                item.disabled && 'cursor-not-allowed opacity-50'
              )}
            >
              {item.icon && <span className="mr-1 inline-flex items-center">{item.icon}</span>}
              {item.label}
            </button>
          );
        })}
      </div>
    );
  }

  // Strip variant — flush row of pill buttons. Caller controls the
  // outer flex layout (`gap-1` is the standard rhythm in
  // settings panels).
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn('flex items-center', stripNav ? 'gap-0.5' : 'gap-1', className)}
    >
      {items.map((item) => {
        const active = item.id === value;
        const labelVisible = !stripCompact || active;
        const labelText = typeof item.label === 'string' ? item.label : undefined;
        return (
          <button
            key={item.id}
            ref={(el) => {
              buttonRefs.current.set(item.id, el);
            }}
            type="button"
            role="tab"
            id={item.tabId}
            aria-selected={active}
            aria-controls={item.panelId}
            aria-label={stripCompact && !labelVisible ? labelText : undefined}
            title={stripCompact && !labelVisible ? labelText : undefined}
            tabIndex={active ? 0 : -1}
            disabled={item.disabled}
            onClick={() => !item.disabled && onChange(item.id)}
            onKeyDown={(e) => onKeyDown(e, item.id)}
            className={cn(
              'app-no-drag inline-flex shrink-0 items-center rounded-inner text-row',
              'transition-colors duration-150',
              stripCompact ? 'gap-1 px-2 py-1.5' : 'gap-1.5 rounded-inner px-2.5 py-1 text-row',
              stripNav
                ? cn(
                    'vx-tab-strip-nav',
                    active ? chromeTabActiveClassName : chromeTabIdleClassName
                  )
                : active
                  ? chromeTabActiveClassName
                  : chromeTabIdleClassName,
              item.disabled && 'cursor-not-allowed opacity-50'
            )}
          >
            {item.icon}
            {labelVisible && (
              <span className={stripCompact ? 'max-w-[9ch] truncate' : undefined}>{item.label}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
