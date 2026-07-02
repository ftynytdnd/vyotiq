/**
 * Primary app surface: chat vs full-screen settings.
 */

import { create } from 'zustand';
import {
  isPersistableSettingsSection,
  resolveSettingsSectionId,
  type SettingsSectionId
} from '@shared/settings/settingsSection.js';
import type { AgentBehaviorSectionId } from '@shared/settings/agentBehaviorSection.js';
import { persistSettingsPatch } from '../lib/persistSettingsPatch.js';
import { useAttachmentPreviewStore } from './useAttachmentPreviewStore.js';
import { useBrowserStore } from './useBrowserStore.js';
import { useEditorStore } from './useEditorStore.js';
import { useTerminalStore } from './useTerminalStore.js';
import { useSettingsStore } from './useSettingsStore.js';
import { useUiStore } from './useUiStore.js';
import { useDockSearchStore } from './useDockSearchStore.js';
import { useDockSchedulesStore } from './useDockSchedulesStore.js';

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

export interface OpenSettingsOptions {
  agentBehaviorSection?: AgentBehaviorSectionId;
}

interface AppViewStore {
  view: AppView;
  settingsSection: SettingsSectionId;
  aboutOpen: boolean;
  settingsSectionBeforeAbout: SettingsSectionId | null;
  /** One-shot deep link consumed by AgentBehaviorPanel on mount. */
  pendingAgentBehaviorSection: AgentBehaviorSectionId | null;
  openSettings: (section?: LegacySettingsTabArg, opts?: OpenSettingsOptions) => void;
  closeSettings: () => void;
  toggleSettings: () => void;
  setSettingsSection: (section: SettingsSectionId) => void;
  consumePendingAgentBehaviorSection: () => AgentBehaviorSectionId | null;
  openAbout: () => void;
  closeAbout: () => void;
}

function clearCompanionOverlays(): void {
  useAttachmentPreviewStore.getState().close();
  useEditorStore.getState().close();
  useTerminalStore.getState().close();
  useBrowserStore.getState().close();
}

function collapseDockForSettings(): void {
  useUiStore.getState().setDockExpanded(false);
  useDockSearchStore.getState().setOpen(false);
  useDockSchedulesStore.getState().setOpen(false);
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
  settingsSectionBeforeAbout: null,
  pendingAgentBehaviorSection: null,
  openSettings: (section?: LegacySettingsTabArg, opts?: OpenSettingsOptions) => {
    clearCompanionOverlays();
    collapseDockForSettings();
    const nextSection = resolveInitialSection(section, get().settingsSection);
    set({
      view: 'settings',
      settingsSection: nextSection,
      aboutOpen: nextSection === 'about',
      pendingAgentBehaviorSection: opts?.agentBehaviorSection ?? null
    });
  },
  consumePendingAgentBehaviorSection: () => {
    const pending = get().pendingAgentBehaviorSection;
    if (pending) set({ pendingAgentBehaviorSection: null });
    return pending;
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
      void persistSettingsPatch({ ui: { lastSettingsTab: section } });
    }
  },
  openAbout: () => {
    const { settingsSection, aboutOpen } = get();
    set({
      view: 'settings',
      settingsSectionBeforeAbout: aboutOpen ? get().settingsSectionBeforeAbout : settingsSection,
      settingsSection: 'about',
      aboutOpen: true
    });
  },
  closeAbout: () => {
    const { settingsSectionBeforeAbout } = get();
    set({
      aboutOpen: false,
      settingsSection: settingsSectionBeforeAbout ?? 'models-api',
      settingsSectionBeforeAbout: null
    });
  }
}));

/** Close settings when opening attachment preview / live diff companions. */
export function closeSettingsForCompanionOpen(): void {
  useAppViewStore.getState().closeSettings();
}
