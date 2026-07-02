/**
 * Shared Shell Mono classes for workbench tab bar + contextual toolbars.
 */

export const WORKBENCH_TOOLBAR_CLASS =
  'vx-workbench-toolbar app-no-drag flex h-9 shrink-0 items-center gap-2 border-b border-border-subtle/25 bg-surface-base px-2';

/** Leading companion label when the tab strip is hidden (single terminal, etc.). */
export const WORKBENCH_PANEL_HEADING_CLASS =
  'flex min-w-0 flex-1 items-center gap-1.5 truncate font-mono text-meta text-text-secondary';

export const WORKBENCH_ICON_BTN_CLASS =
  'vx-workbench-icon-btn app-no-drag flex items-center justify-center rounded p-1 text-text-muted transition-colors hover:bg-chrome-hover-soft hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40';

export const WORKBENCH_ACTIONS_TRAY_CLASS =
  'flex shrink-0 items-center gap-0.5 border-l border-border-subtle/20 pl-1.5';

export const WORKBENCH_ACTION_GROUP_CLASS = 'flex shrink-0 items-center gap-0.5';

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
