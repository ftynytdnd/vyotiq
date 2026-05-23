/** Shared constants and class strings for the left navigation dock. */

export const CONV_DRAG_MIME = 'application/x-vyotiq-conversation';

export const DOCK_TAB_FOCUS =
  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-subtle/50';

/** Hover-only dock actions stay visible on keyboard focus. */
export const DOCK_HOVER_ACTIONS =
  'opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100';

export const DOCK_WIDTH_DEFAULT = 260;
export const DOCK_WIDTH_MIN = 220;
export const DOCK_WIDTH_MAX = 360;
export const DOCK_WIDTH_COLLAPSED_PX = 40;

/** Single hairline used for the dock outer edge and internal dividers. */
export const DOCK_BORDER_OPACITY = 'border-border-subtle/25';

/** Right edge of the expanded/collapsed dock panel. */
export const DOCK_EDGE_CLASS = `border-r ${DOCK_BORDER_OPACITY}`;

/** Horizontal rules inside the dock (section split). */
export const DOCK_DIVIDER_H_CLASS = 'mx-2 h-px shrink-0 bg-border-subtle/25';

/** Top border for dock footer zones. */
export const DOCK_FOOTER_CLASS = `shrink-0 border-t ${DOCK_BORDER_OPACITY} bg-surface-raised`;

/** Resize hit target — visual edge comes from {@link DOCK_EDGE_CLASS} on the nav. */
export const DOCK_RESIZE_HANDLE_CLASS =
  'absolute inset-y-0 right-0 z-10 w-1.5 cursor-col-resize';

/** Max workspace rows before the dock caps the workspaces panel height. */
export const DOCK_WORKSPACE_PANEL_CAP = 3;

export function workspacePanelClassName(workspaceCount: number): string {
  if (workspaceCount <= DOCK_WORKSPACE_PANEL_CAP) {
    return 'flex shrink-0 flex-col overflow-hidden';
  }
  return 'flex min-h-0 max-h-[38%] shrink-0 flex-col overflow-hidden';
}

export function clampDockWidth(width: number): number {
  return Math.min(DOCK_WIDTH_MAX, Math.max(DOCK_WIDTH_MIN, Math.round(width)));
}
