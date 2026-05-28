/** Shared constants and class strings for the left navigation dock. */

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

/** Lucide icon sizing — matches Vyotiq UI {@link vx-tab} (mockup kit). */
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
export const DOCK_WIDTH_COLLAPSED_PX = 44;

export const DOCK_INSET_CLASS = 'flex min-h-0 flex-1 flex-col gap-1.5 px-1.5';

export const DOCK_DIVIDER_H_CLASS = 'mx-2 h-0 shrink-0';

export const DOCK_FOOTER_CLASS = 'shrink-0';

export const DOCK_FOOTER_TOOLBAR_CLASS = 'px-1.5 py-0.5';

/** Empty / loading copy — icon + muted text, no background box. */
export const DOCK_EMPTY_STATE_CLASS =
  'mx-2 flex flex-col items-start gap-1.5 px-1 py-2 text-row text-text-muted';

export function dockInlineActionClassName(): string {
  return cn('vx-btn vx-btn-quiet px-2 text-row');
}

export const DOCK_RESIZE_HANDLE_CLASS =
  'absolute inset-y-0 right-0 z-10 w-1.5 cursor-col-resize';

export const DOCK_WORKSPACE_PANEL_CAP = 3;

export function workspacePanelClassName(workspaceCount: number): string {
  if (workspaceCount <= DOCK_WORKSPACE_PANEL_CAP) {
    return 'flex min-h-0 shrink-0 flex-col overflow-hidden';
  }
  return 'flex min-h-0 max-h-[38%] shrink-0 flex-col overflow-hidden';
}

export function clampDockWidth(width: number): number {
  return Math.min(DOCK_WIDTH_MAX, Math.max(DOCK_WIDTH_MIN, Math.round(width)));
}

export function dockWorkspaceIndicatorLabel(label: string | null): string {
  if (!label || label.trim().length === 0) return '—';
  const trimmed = label.trim();
  if (trimmed.length <= 3) return trimmed;
  return trimmed.slice(0, 3);
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

/** Fill color for dock / composer context meters from usage ratio. */
export function dockChatMeterBarClassName(ratio: number): string {
  if (ratio >= 0.9) return 'bg-danger';
  if (ratio >= 0.7) return 'bg-warning';
  return 'bg-edge-light-meter';
}
