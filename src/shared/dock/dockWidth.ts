/**
 * Dock flyout width bounds — shared by renderer layout and main-process
 * settings validation / migration so stale on-disk values cannot block saves.
 */

export const DOCK_WIDTH_DEFAULT = 260;
export const DOCK_WIDTH_MIN = 220;
export const DOCK_WIDTH_MAX = 320;

/** Persistent left edge strip width (px) — flyout expands to the right. */
export const DOCK_STRIP_WIDTH = 44;

/** Main content left inset: inline nav flyout when expanded (no edge strip). */
export function dockMainPaddingLeft(expanded: boolean, panelWidth: number): number {
  return expanded ? panelWidth : 0;
}

export function clampDockWidth(width: number): number {
  return Math.min(DOCK_WIDTH_MAX, Math.max(DOCK_WIDTH_MIN, Math.round(width)));
}

/**
 * Clamp `ui.dockWidth` when present. Returns `changed: true` when the
 * stored value was out of range (e.g. legacy 200px default).
 */
export function normalizeDockWidthInUi<T extends Record<string, unknown>>(
  ui: T
): { ui: T; changed: boolean } {
  if (typeof ui.dockWidth !== 'number' || !Number.isFinite(ui.dockWidth)) {
    return { ui, changed: false };
  }
  const clamped = clampDockWidth(ui.dockWidth);
  if (clamped === ui.dockWidth) return { ui, changed: false };
  return { ui: { ...ui, dockWidth: clamped }, changed: true };
}
