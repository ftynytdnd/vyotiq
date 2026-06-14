/**
 * Workbench side-pane width bounds — shared by renderer layout and main-process
 * settings validation so stale on-disk values cannot block saves.
 */

export const WORKBENCH_PANE_WIDTH_DEFAULT = 480;
export const WORKBENCH_PANE_WIDTH_MIN = 320;
export const WORKBENCH_PANE_WIDTH_MAX = 900;

export function clampWorkbenchPaneWidth(width: number): number {
  return Math.min(
    WORKBENCH_PANE_WIDTH_MAX,
    Math.max(WORKBENCH_PANE_WIDTH_MIN, Math.round(width))
  );
}

/**
 * Clamp `ui.workbenchPaneWidth` when present. Returns `changed: true` when the
 * stored value was out of range.
 */
export function normalizeWorkbenchPaneWidthInUi<T extends Record<string, unknown>>(
  ui: T
): { ui: T; changed: boolean } {
  if (typeof ui.workbenchPaneWidth !== 'number' || !Number.isFinite(ui.workbenchPaneWidth)) {
    return { ui, changed: false };
  }
  const clamped = clampWorkbenchPaneWidth(ui.workbenchPaneWidth);
  if (clamped === ui.workbenchPaneWidth) return { ui, changed: false };
  return { ui: { ...ui, workbenchPaneWidth: clamped }, changed: true };
}
