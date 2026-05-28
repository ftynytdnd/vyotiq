/**
 * Secondary zone — right-side panel visibility for Settings,
 * Checkpoints history, and Context Inspector. Closed by default;
 * opens on demand and sits beside the conversation surface.
 *
 * Strict single overlay slot: opening any panel type closes all others
 * (settings, checkpoints, inspector, review, attachment preview, live diff).
 */

import { create } from 'zustand';
import { vyotiq } from '../lib/ipc.js';
import { useAttachmentPreviewStore } from './useAttachmentPreviewStore.js';
import { useCheckpointsStore } from './useCheckpointsStore.js';
import { useContextSummaryStore } from './useContextSummaryStore.js';
import { useFloatingLiveDiffStore } from './useFloatingLiveDiffStore.js';
import { useSettingsStore } from './useSettingsStore.js';

export type SettingsTabId =
  | 'providers'
  | 'permissions'
  | 'context'
  | 'checkpoints'
  | 'memory'
  | 'appearance'
  | 'shortcuts'
  | 'about';

export type CheckpointsTab = 'runs' | 'files' | 'review';

export type SecondaryPanel = 'settings' | 'checkpoints' | 'inspector';

const SETTINGS_TAB_IDS: SettingsTabId[] = [
  'providers',
  'permissions',
  'context',
  'checkpoints',
  'memory',
  'appearance',
  'shortcuts',
  'about'
];

interface OpenCheckpointsOpts {
  conversationId?: string;
  workspaceId?: string;
}

interface SecondaryZoneStore {
  panel: SecondaryPanel | null;
  settingsTab: SettingsTabId;
  checkpointsTab: CheckpointsTab;
  openSettings: (tab?: SettingsTabId) => void;
  openCheckpoints: (tab?: CheckpointsTab, opts?: OpenCheckpointsOpts) => void;
  /** Opens the inspector panel and loads data for the bound id. */
  openInspector: (id: string, mode?: 'live' | 'idle') => void;
  /** Remember the last settings tab the user viewed. */
  setSettingsTab: (tab: SettingsTabId) => void;
  close: () => void;
  /** Close every floating overlay (secondary, preview, live diff). */
  closeAllOverlays: () => void;
  /** Clear other overlays before opening preview / live diff. */
  closeForCompanionOpen: () => void;
}

function isSettingsTabId(value: string | undefined): value is SettingsTabId {
  return value !== undefined && SETTINGS_TAB_IDS.includes(value as SettingsTabId);
}

/** Clears every floating overlay slot (secondary, preview, live diff). */
function clearOverlaySlot(panel: SecondaryPanel | null): void {
  if (panel === 'inspector') {
    useContextSummaryStore.getState().close();
  }
  useAttachmentPreviewStore.getState().close();
  useFloatingLiveDiffStore.getState().close();
}

function refreshCheckpointsForOpen(opts?: OpenCheckpointsOpts): void {
  const cid = opts?.conversationId;
  if (cid) {
    void useCheckpointsStore.getState().refreshPending(cid);
  }
}

function resolveSettingsTab(tab: SettingsTabId | undefined, fallback: SettingsTabId): SettingsTabId {
  if (tab) return tab;
  const persisted = useSettingsStore.getState().settings.ui?.lastSettingsTab;
  if (isSettingsTabId(persisted)) return persisted;
  return fallback;
}

export const useSecondaryZoneStore = create<SecondaryZoneStore>((set, get) => ({
  panel: null,
  settingsTab: 'providers',
  checkpointsTab: 'runs',
  openSettings: (tab?: SettingsTabId) => {
    const { panel } = get();
    clearOverlaySlot(panel);
    const nextTab = resolveSettingsTab(tab, get().settingsTab);
    set({ panel: 'settings', settingsTab: nextTab });
  },
  openCheckpoints: (tab = 'runs', opts) => {
    const { panel } = get();
    clearOverlaySlot(panel);
    refreshCheckpointsForOpen(opts);
    const cid = opts?.conversationId;
    let resolvedTab = tab;
    if (tab === 'runs' && cid) {
      const pending = useCheckpointsStore.getState().pendingByConversation[cid] ?? [];
      if (pending.length > 0) resolvedTab = 'review';
    }
    set({ panel: 'checkpoints', checkpointsTab: resolvedTab });
  },
  openInspector: (id, mode = 'idle') => {
    const { panel } = get();
    clearOverlaySlot(panel);
    set({ panel: 'inspector' });
    void useContextSummaryStore.getState().open(id, mode);
  },
  setSettingsTab: (tab) => {
    set({ settingsTab: tab });
    const ui = useSettingsStore.getState().settings.ui ?? {};
    void vyotiq.settings.set({ ui: { ...ui, lastSettingsTab: tab } });
  },
  close: () => {
    const { panel } = get();
    set({ panel: null });
    if (panel === 'inspector') {
      useContextSummaryStore.getState().close();
    }
  },
  closeAllOverlays: () => {
    const { panel } = get();
    clearOverlaySlot(panel);
    set({ panel: null });
  },
  closeForCompanionOpen: () => {
    const { panel } = get();
    clearOverlaySlot(panel);
    set({ panel: null });
  }
}));
