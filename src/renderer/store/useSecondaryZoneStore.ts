/**
 * Secondary zone — right-side Settings panel visibility.
 * Closed by default; opens on demand beside the conversation surface.
 */

import { create } from 'zustand';
import { vyotiq } from '../lib/ipc.js';
import { useAttachmentPreviewStore } from './useAttachmentPreviewStore.js';
import { useFloatingLiveDiffStore } from './useFloatingLiveDiffStore.js';
import { useSettingsStore } from './useSettingsStore.js';

export type SettingsTabId =
  | 'providers'
  | 'checkpoints'
  | 'memory'
  | 'appearance'
  | 'shortcuts'
  | 'about';

const SETTINGS_TAB_IDS: SettingsTabId[] = [
  'providers',
  'checkpoints',
  'memory',
  'appearance',
  'shortcuts',
  'about'
];

const LEGACY_SETTINGS_TAB: Record<string, SettingsTabId> = {
  permissions: 'providers',
  context: 'providers'
};

interface SecondaryZoneStore {
  panel: 'settings' | null;
  settingsTab: SettingsTabId;
  openSettings: (tab?: SettingsTabId | 'permissions' | 'context') => void;
  setSettingsTab: (tab: SettingsTabId) => void;
  close: () => void;
  closeAllOverlays: () => void;
  closeForCompanionOpen: () => void;
}

function isSettingsTabId(value: string | undefined): value is SettingsTabId {
  return value !== undefined && SETTINGS_TAB_IDS.includes(value as SettingsTabId);
}

function resolvePersistedTab(value: string | undefined): SettingsTabId | undefined {
  if (isSettingsTabId(value)) return value;
  if (value !== undefined && value in LEGACY_SETTINGS_TAB) {
    return LEGACY_SETTINGS_TAB[value];
  }
  return undefined;
}

function clearOverlaySlot(): void {
  useAttachmentPreviewStore.getState().close();
  useFloatingLiveDiffStore.getState().close();
}

function normalizeTabArg(tab: SettingsTabId | string | undefined): SettingsTabId | undefined {
  if (tab === undefined) return undefined;
  if (isSettingsTabId(tab)) return tab;
  if (tab in LEGACY_SETTINGS_TAB) {
    return LEGACY_SETTINGS_TAB[tab as keyof typeof LEGACY_SETTINGS_TAB];
  }
  return undefined;
}

function resolveSettingsTab(tab: SettingsTabId | string | undefined, fallback: SettingsTabId): SettingsTabId {
  const normalized = normalizeTabArg(tab);
  if (normalized) return normalized;
  const persisted = useSettingsStore.getState().settings.ui?.lastSettingsTab;
  return resolvePersistedTab(persisted) ?? fallback;
}

export const useSecondaryZoneStore = create<SecondaryZoneStore>((set, get) => ({
  panel: null,
  settingsTab: 'providers',
  openSettings: (tab?: SettingsTabId | 'permissions' | 'context') => {
    clearOverlaySlot();
    const nextTab = resolveSettingsTab(tab, get().settingsTab);
    set({ panel: 'settings', settingsTab: nextTab });
  },
  setSettingsTab: (tab) => {
    set({ settingsTab: tab });
    const ui = useSettingsStore.getState().settings.ui ?? {};
    void vyotiq.settings.set({ ui: { ...ui, lastSettingsTab: tab } });
  },
  close: () => {
    set({ panel: null });
  },
  closeAllOverlays: () => {
    clearOverlaySlot();
    set({ panel: null });
  },
  closeForCompanionOpen: () => {
    clearOverlaySlot();
    set({ panel: null });
  }
}));
