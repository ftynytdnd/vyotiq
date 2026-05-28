import { useCallback, useEffect } from 'react';
import { vyotiq } from '../lib/ipc.js';
import { useSettingsStore } from '../store/useSettingsStore.js';

const DEFAULT_WIDTH = 480;
const PERSIST_DEBOUNCE_MS = 200;

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let pendingByKey: Record<string, number> = {};

function flushPanelWidthsNow(): void {
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  const keys = Object.keys(pendingByKey);
  if (keys.length === 0) return;
  const snapshot = { ...pendingByKey };
  pendingByKey = {};
  const ui = useSettingsStore.getState().settings.ui ?? {};
  const prev = ui.panelWidths ?? {};
  const next = { ...prev };
  for (const key of keys) {
    next[key] = snapshot[key]!;
  }
  void vyotiq.settings.set({
    ui: { ...ui, panelWidths: next }
  });
}

/** Read/write floating panel width via `settings.ui.panelWidths`. */
export function usePersistedPanelWidth(widthKey: string) {
  const settings = useSettingsStore((s) => s.settings);
  const initialWidth = settings.ui?.panelWidths?.[widthKey] ?? DEFAULT_WIDTH;

  const onWidthChange = useCallback(
    (width: number) => {
      pendingByKey[widthKey] = width;
      if (persistTimer !== null) clearTimeout(persistTimer);
      persistTimer = setTimeout(flushPanelWidthsNow, PERSIST_DEBOUNCE_MS);
    },
    [widthKey]
  );

  useEffect(() => () => flushPanelWidthsNow(), []);

  return { initialWidth, onWidthChange };
}
