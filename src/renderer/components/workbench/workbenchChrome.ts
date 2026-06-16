/**
 * Shared Shell Mono classes for workbench tab bar + contextual toolbars.
 */

export const WORKBENCH_TOOLBAR_CLASS =
  'vx-workbench-toolbar app-no-drag flex h-8 shrink-0 items-center gap-2 border-b border-border-subtle/20 px-2';

export const WORKBENCH_ICON_BTN_CLASS =
  'vx-workbench-icon-btn app-no-drag flex items-center justify-center rounded p-1 text-text-muted transition-colors hover:bg-chrome-hover-soft hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40';

export const WORKBENCH_ACTIONS_TRAY_CLASS =
  'flex shrink-0 items-center gap-0.5 border-l border-border-subtle/20 pl-1.5';

export const WORKBENCH_ACTION_GROUP_CLASS = 'flex shrink-0 items-center gap-0.5';

/** Fixed right edge strip — mirrors left {@link DOCK_EDGE_STRIP_CLASS}. */
export const WORKBENCH_EDGE_CONTAINER_CLASS =
  'absolute right-0 top-0 bottom-0 z-(--z-dock-rail) flex min-h-0 pointer-events-none';

export const WORKBENCH_EDGE_STRIP_CLASS =
  'vx-workbench-edge-strip vx-dock-shell app-no-drag pointer-events-auto flex w-11 shrink-0 flex-col items-center justify-start gap-1 bg-surface-base pt-[var(--dock-strip-pt)] pb-2';

/** Icon slot in the right workbench rail — matches dock rail sizing. */
export const WORKBENCH_RAIL_BTN_CLASS =
  'vx-dock-icon-slot vx-btn vx-btn-quiet px-0 vx-dock-icon-hover text-text-muted';

/** Subtle 1px inset card for workbench empty states. */
export const WORKBENCH_EMPTY_CARD_CLASS =
  'vx-workbench-empty-card rounded-inner px-5 py-6';

/** Trailing tray on the workbench tab bar (terminal sessions, etc.). */
export const WORKBENCH_TAB_TRAY_CLASS =
  'vx-workbench-tab-tray app-no-drag flex shrink-0 items-center gap-1 border-l border-border-subtle/25 px-1.5 py-1';

export const WORKBENCH_TAB_CLASS =
  'vx-workbench-tab group flex max-w-[12rem] shrink-0 items-center gap-1 border-b-2 border-transparent px-2.5 py-1 text-meta transition-colors';

export function workbenchTabActiveClass(active: boolean): string {
  return active
    ? 'border-accent bg-chrome-hover-soft text-text-primary'
    : 'text-text-muted hover:bg-chrome-hover-soft/60';
}

/** Active-state tint for toolbar toggle buttons (find, split, etc.). */
export function workbenchToolbarToggleClass(active: boolean): string {
  return active ? 'bg-chrome-hover-soft text-text-primary' : '';
}
