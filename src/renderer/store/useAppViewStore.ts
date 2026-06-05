/**
 * Primary app surface: chat vs full-screen settings.
 */

import { create } from 'zustand';
import {
  isPersistableSettingsSection,
  resolveSettingsSectionId,
  type SettingsSectionId
} from '@shared/settings/settingsSection.js';
import { vyotiq } from '../lib/ipc.js';
import { useAttachmentPreviewStore } from './useAttachmentPreviewStore.js';
import { useFloatingLiveDiffStore } from './useFloatingLiveDiffStore.js';
import { useSettingsStore } from './useSettingsStore.js';

export type { SettingsSectionId };

/** @deprecated Legacy tab aliases accepted by openSettings. */
export type LegacySettingsTabArg =
  | SettingsSectionId
  | 'providers'
  | 'permissions'
  | 'context'
  | 'checkpoints'
  | 'memory';

export type AppView = 'chat' | 'settings';

interface AppViewStore {
  view: AppView;
  settingsSection: SettingsSectionId;
  aboutOpen: boolean;
  openSettings: (section?: LegacySettingsTabArg) => void;
  closeSettings: () => void;
  toggleSettings: () => void;
  setSettingsSection: (section: SettingsSectionId) => void;
  openAbout: () => void;
  closeAbout: () => void;
}

function clearCompanionOverlays(): void {
  useAttachmentPreviewStore.getState().close();
  useFloatingLiveDiffStore.getState().close();
}

function normalizeSectionArg(
  section: LegacySettingsTabArg | undefined,
  fallback: SettingsSectionId
): SettingsSectionId {
  if (section === undefined) return fallback;
  return resolveSettingsSectionId(section, fallback);
}

function resolveInitialSection(
  section: LegacySettingsTabArg | undefined,
  fallback: SettingsSectionId
): SettingsSectionId {
  if (section !== undefined) return normalizeSectionArg(section, fallback);
  const persisted = useSettingsStore.getState().settings.ui?.lastSettingsTab;
  return resolveSettingsSectionId(persisted, fallback);
}

export const useAppViewStore = create<AppViewStore>((set, get) => ({
  view: 'chat',
  settingsSection: 'models-api',
  aboutOpen: false,
  openSettings: (section?: LegacySettingsTabArg) => {
    clearCompanionOverlays();
    const nextSection = resolveInitialSection(section, get().settingsSection);
    set({
      view: 'settings',
      settingsSection: nextSection,
      aboutOpen: nextSection === 'about'
    });
  },
  closeSettings: () => {
    set({ view: 'chat', aboutOpen: false });
  },
  toggleSettings: () => {
    if (get().view === 'settings') {
      get().closeSettings();
    } else {
      get().openSettings();
    }
  },
  setSettingsSection: (section) => {
    set({ settingsSection: section, aboutOpen: section === 'about' });
    if (isPersistableSettingsSection(section)) {
      void vyotiq.settings.set({ ui: { lastSettingsTab: section } });
    }
  },
  openAbout: () => {
    set({ view: 'settings', settingsSection: 'about', aboutOpen: true });
  },
  closeAbout: () => {
    set({ aboutOpen: false, settingsSection: 'models-api' });
  }
}));

/** Close settings when opening attachment preview / live diff companions. */
export function closeSettingsForCompanionOpen(): void {
  useAppViewStore.getState().closeSettings();
}
