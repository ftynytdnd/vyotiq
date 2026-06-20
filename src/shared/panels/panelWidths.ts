/**
 * Floating composer popover width bounds — shared by renderer layout and
 * main-process settings validation.
 */

export const PANEL_WIDTH_DEFAULT = 640;
export const PANEL_WIDTH_MIN = 320;
export const PANEL_WIDTH_MAX = 720;

/** Known resizable popover panels persisted in `ui.panelWidths`. */
export const PANEL_IDS = {
  MODEL_PICKER: 'model-picker',
  MENTION_PICKER: 'mention-picker',
  CAPTURE_PICKER: 'capture-picker',
  CONTEXT_BREAKDOWN: 'context-breakdown'
} as const;

export type PanelId = (typeof PANEL_IDS)[keyof typeof PANEL_IDS];

export function clampPanelWidth(width: number): number {
  return Math.min(PANEL_WIDTH_MAX, Math.max(PANEL_WIDTH_MIN, Math.round(width)));
}

/**
 * Clamp every entry in `ui.panelWidths` when present. Returns `changed: true`
 * when any stored value was out of range.
 */
export function normalizePanelWidthsInUi<T extends Record<string, unknown>>(
  ui: T
): { ui: T; changed: boolean } {
  const raw = ui.panelWidths;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ui, changed: false };
  }
  let changed = false;
  const next: Record<string, number> = {};
  for (const [panelId, w] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof w !== 'number' || !Number.isFinite(w)) continue;
    const clamped = clampPanelWidth(w);
    next[panelId] = clamped;
    if (clamped !== w) changed = true;
  }
  if (!changed && Object.keys(next).length === Object.keys(raw).length) {
    return { ui, changed: false };
  }
  return { ui: { ...ui, panelWidths: next }, changed: true };
}
