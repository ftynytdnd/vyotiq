/** Shared constants and class strings for the left navigation dock. */

import { useDockSearchStore } from '../../store/useDockSearchStore.js';
import { useUiStore } from '../../store/useUiStore.js';
import { cn } from '../../lib/cn.js';
import {
  SHELL_DOCK_TAB_ICON_CLASS,
  SHELL_TAB_ICON_STROKE
} from '../../lib/shellIcons.js';

export const CONV_DRAG_MIME = 'application/x-vyotiq-conversation';

/**
 * Hover-only dock actions. Hidden from layout until hover or keyboard focus
 * so tab labels can use the full row width (audit #20).
 */
export const DOCK_HOVER_ACTIONS =
  'hidden shrink-0 items-center group-hover:flex focus-within:flex';

/** Lucide icon sizing — matches Vyotiq UI {@link vx-tab}. */
export const DOCK_TAB_ICON_CLASS = SHELL_DOCK_TAB_ICON_CLASS;
export const DOCK_TAB_ICON_STROKE = SHELL_TAB_ICON_STROKE;

/** Primary label inside a dock tab row. */
export const DOCK_TAB_LABEL_CLASS = 'vx-dock-tab-label';

/** Inner activate control — inherits row color/typography; label ellipsis via {@link DOCK_TAB_LABEL_CLASS}. */
export const DOCK_TAB_TRIGGER_CLASS = 'vx-dock-tab-trigger';

const DOCK_TAB_ROW_CLASS = cn('vx-dock-tab group app-no-drag shrink-0');

export const DOCK_WIDTH_DEFAULT = 200;
const DOCK_WIDTH_MIN = 180;
export const DOCK_WIDTH_MAX = 320;

export const DOCK_INSET_CLASS = 'flex min-h-0 flex-1 flex-col gap-1 px-1.5';

export const DOCK_DIVIDER_H_CLASS = 'mx-2 h-0 shrink-0';

export const DOCK_FOOTER_CLASS = 'shrink-0';

export const DOCK_FOOTER_TOOLBAR_CLASS = 'px-1.5 py-0';

/** Empty / loading copy — icon + muted text, no background box. */
export const DOCK_EMPTY_STATE_CLASS =
  'mx-2 flex flex-col items-start gap-1.5 px-1 py-2 text-row text-text-muted';

export function dockInlineActionClassName(): string {
  return cn('vx-btn vx-btn-quiet px-2 text-row');
}

export function dockWorkspaceActionClassName(): string {
  return cn(dockInlineActionClassName(), 'min-w-0 flex-1 justify-center');
}

export const DOCK_RESIZE_HANDLE_CLASS =
  'vx-dock-resize-handle absolute inset-y-0 right-0 z-10 w-1.5 cursor-col-resize';

/** Persistent edge strip width (px) — flyout expands to the right. */
export const DOCK_STRIP_WIDTH = 44;

export const DOCK_EDGE_CONTAINER_CLASS = cn(
  'absolute left-0 top-[var(--titlebar-h)] bottom-0 z-(--z-dock-panel) flex min-h-0'
);

export function dockFlyoutShellClassName(isResizing: boolean): string {
  return cn(
    'vx-dock-shell vx-dock-flyout app-no-drag',
    'flex min-h-0 max-h-full flex-1 flex-col overflow-hidden',
    isResizing ? '' : 'transition-[width] duration-200 ease-out'
  );
}

export const DOCK_EDGE_STRIP_CLASS = cn(
  'vx-dock-edge-strip vx-dock-shell app-no-drag',
  'flex w-11 shrink-0 flex-col items-center justify-between border-r border-border-subtle/50',
  'bg-surface-raised py-2'
);

export function workspacePanelClassName(_workspaceCount: number): string {
  return 'flex min-h-0 flex-1 flex-col overflow-hidden';
}

/** Collapse flyout after workspace/chat selection (strip stays visible). */
export function collapseDockAfterSelection(): void {
  useDockSearchStore.getState().setOpen(false);
  useUiStore.getState().setDockExpanded(false);
}

export function clampDockWidth(width: number): number {
  return Math.min(DOCK_WIDTH_MAX, Math.max(DOCK_WIDTH_MIN, Math.round(width)));
}

/** Active chat tab — stacks title row + context meter. */
export const DOCK_CHAT_TAB_STACK_CLASS = 'flex flex-col gap-0';

/** Inner title/actions row inside a chat tab. */
export const DOCK_CHAT_TAB_INNER_CLASS = cn(
  'flex w-full min-w-0 items-center gap-1'
);

export function dockTabRowClassName(
  _active: boolean,
  _kind: 'chat' | 'workspace'
): string {
  return DOCK_TAB_ROW_CLASS;
}

/** data-active attribute value for {@link dockTabRowClassName} rows. */
export function dockTabActiveAttr(active: boolean): 'true' | 'false' {
  return active ? 'true' : 'false';
}

/** Close dock search first, then collapse the expanded flyout. */
export function dismissDockFlyout(): void {
  const search = useDockSearchStore.getState();
  if (search.open) {
    search.setOpen(false);
    return;
  }
  useUiStore.getState().setDockExpanded(false);
}
