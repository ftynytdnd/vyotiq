import { useCallback, useEffect } from 'react';
import { vyotiq } from '../lib/ipc.js';
import { useSettingsStore } from '../store/useSettingsStore.js';

/** Default floating panel width — matches {@link FloatingPanel} and settings validation. */
export const PANEL_WIDTH_DEFAULT = 480;
const PERSIST_DEBOUNCE_MS = 200;

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let pendingByKey: Record<string, number> = {};

export function flushPanelWidthPersistence(): void {
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  const keys = Object.keys(pendingByKey);
  if (keys.length === 0) return;
  const snapshot = { ...pendingByKey };
  pendingByKey = {};
  const prev = useSettingsStore.getState().settings.ui?.panelWidths ?? {};
  const next = { ...prev };
  for (const key of keys) {
    next[key] = snapshot[key]!;
  }
  void vyotiq.settings.set({ ui: { panelWidths: next } }).catch(() => {
    /* best-effort on unload */
  });
}

/**
 * Read/write floating panel width via `settings.ui.panelWidths`.
 * Pass an empty string to skip persistence (caller supplies width).
 */
export function usePersistedPanelWidth(widthKey: string) {
  const settings = useSettingsStore((s) => s.settings);
  const persist = widthKey.length > 0;
  const initialWidth = persist
    ? (settings.ui?.panelWidths?.[widthKey] ?? PANEL_WIDTH_DEFAULT)
    : PANEL_WIDTH_DEFAULT;

  const onWidthChange = useCallback(
    (width: number) => {
      if (!persist) return;
      pendingByKey[widthKey] = width;
      if (persistTimer !== null) clearTimeout(persistTimer);
      persistTimer = setTimeout(flushPanelWidthPersistence, PERSIST_DEBOUNCE_MS);
    },
    [persist, widthKey]
  );

  useEffect(() => () => flushPanelWidthPersistence(), []);

  return { initialWidth, onWidthChange, persist };
}
