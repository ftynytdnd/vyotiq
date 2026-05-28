/** Shared constants and class strings for the left navigation dock. */

import {
  chromeEdgeClassName,
  chromePillClassName,
  chromeTabActiveClassName,
  chromeTabIdleClassName
} from '../ui/SurfaceShell.js';
import { cn } from '../../lib/cn.js';

export const CONV_DRAG_MIME = 'application/x-vyotiq-conversation';

/** Hover-only dock actions stay visible on keyboard focus. */
export const DOCK_HOVER_ACTIONS =
  'opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100';

const DOCK_TAB_ROW_CLASS = cn(
  'group app-no-drag flex w-full max-w-none shrink-0 items-center gap-1 rounded-inner px-2 py-1',
  'text-row transition-colors duration-150'
);

const DOCK_TAB_ACTIVE_CLASS = chromeTabActiveClassName;
const DOCK_TAB_IDLE_CLASS = chromeTabIdleClassName;

export const DOCK_WIDTH_DEFAULT = 260;
const DOCK_WIDTH_MIN = 220;
export const DOCK_WIDTH_MAX = 360;
export const DOCK_WIDTH_COLLAPSED_PX = 40;

export const DOCK_EDGE_CLASS = cn('border-r', chromeEdgeClassName);

export const DOCK_INSET_CLASS = 'flex min-h-0 flex-1 flex-col gap-2 px-2';

export const DOCK_DIVIDER_H_CLASS = 'mx-2 h-px shrink-0 bg-border-subtle/25';

export const DOCK_FOOTER_CLASS = cn('shrink-0 border-t', chromeEdgeClassName);

export const DOCK_FOOTER_TOOLBAR_CLASS = 'px-1.5 py-0.5';

/** Empty / loading copy — no background box. */
export const DOCK_EMPTY_STATE_CLASS =
  'mx-2 flex flex-col gap-1.5 px-1 py-1 text-row text-text-faint';

export function dockInlineActionClassName(): string {
  return cn(chromePillClassName(), 'px-2 text-row');
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

/** Peak-context meter track under the active chat tab. */
export const DOCK_CHAT_METER_TRACK_CLASS =
  'relative block h-0.5 w-full overflow-hidden rounded-pill bg-border-subtle/30';

export function dockTabRowClassName(
  active: boolean,
  _kind: 'chat' | 'workspace'
): string {
  return cn(
    DOCK_TAB_ROW_CLASS,
    active ? DOCK_TAB_ACTIVE_CLASS : DOCK_TAB_IDLE_CLASS
  );
}

/** Fill color for dock / composer context meters from usage ratio. */
export function dockChatMeterBarClassName(ratio: number): string {
  if (ratio >= 0.9) return 'bg-danger';
  if (ratio >= 0.7) return 'bg-warning';
  return 'bg-accent/80';
}
