/**
 * Secondary zone — right-side panel visibility for Settings,
 * Checkpoints history, and Context Inspector. Closed by default;
 * opens on demand and sits beside the conversation surface.
 */

import { create } from 'zustand';
import { useContextSummaryStore } from './useContextSummaryStore.js';

export type SettingsTabId =
  | 'providers'
  | 'permissions'
  | 'context'
  | 'checkpoints'
  | 'memory'
  | 'about';

export type SecondaryPanel = 'settings' | 'checkpoints' | 'inspector';

/** Panel-specific widths tuned to content density. */
export const SECONDARY_ZONE_WIDTH: Record<SecondaryPanel, string> = {
  settings: 'min(480px,42vw)',
  checkpoints: 'min(400px,36vw)',
  inspector: 'min(480px,40vw)'
};

interface SecondaryZoneStore {
  panel: SecondaryPanel | null;
  settingsTab: SettingsTabId;
  openSettings: (tab?: SettingsTabId) => void;
  openCheckpoints: () => void;
  /** Opens the inspector panel and loads data for the bound id. */
  openInspector: (id: string, mode?: 'live' | 'idle') => void;
  /** Remember the last settings tab the user viewed. */
  setSettingsTab: (tab: SettingsTabId) => void;
  close: () => void;
}

export const useSecondaryZoneStore = create<SecondaryZoneStore>((set, get) => ({
  panel: null,
  settingsTab: 'providers',
  openSettings: (tab?: SettingsTabId) => {
    if (get().panel === 'inspector') {
      useContextSummaryStore.getState().close();
    }
    const nextTab = tab ?? get().settingsTab;
    set({ panel: 'settings', settingsTab: nextTab });
  },
  openCheckpoints: () => {
    if (get().panel === 'inspector') {
      useContextSummaryStore.getState().close();
    }
    set({ panel: 'checkpoints' });
  },
  openInspector: (id, mode = 'idle') => {
    set({ panel: 'inspector' });
    void useContextSummaryStore.getState().open(id, mode);
  },
  setSettingsTab: (tab) => {
    set({ settingsTab: tab });
  },
  close: () => {
    const { panel } = get();
    set({ panel: null });
    if (panel === 'inspector') {
      useContextSummaryStore.getState().close();
    }
  }
}));
