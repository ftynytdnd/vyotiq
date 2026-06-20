/**
 * Reads and persists a single floating panel width from `ui.panelWidths`.
 */

import { useCallback, useMemo } from 'react';
import {
  clampPanelWidth,
  PANEL_WIDTH_DEFAULT,
  type PanelId
} from '@shared/panels/panelWidths.js';
import { useSettingsStore } from '../store/useSettingsStore.js';
import { persistSettingsPatch } from './persistSettingsPatch.js';

export function usePersistedPanelWidth(
  panelId: PanelId | undefined,
  fallback = PANEL_WIDTH_DEFAULT
): { width: number; persistWidth: (next: number) => void } {
  const stored = useSettingsStore((s) =>
    panelId ? s.settings.ui?.panelWidths?.[panelId] : undefined
  );

  const width = useMemo(
    () => clampPanelWidth(typeof stored === 'number' ? stored : fallback),
    [stored, fallback]
  );

  const persistWidth = useCallback(
    (next: number) => {
      if (!panelId) return;
      const clamped = clampPanelWidth(next);
      void persistSettingsPatch({
        ui: { panelWidths: { [panelId]: clamped } }
      }).catch(() => {});
    },
    [panelId]
  );

  return { width, persistWidth };
}
