/**
 * Secondary zone — right-side panel visibility for Settings,
 * Checkpoints history, Context Inspector, and PR review. Closed by
 * default; opens on demand and sits beside the conversation surface.
 */

import { create } from 'zustand';
import { useContextSummaryStore } from './useContextSummaryStore.js';
import { useCheckpointsStore } from './useCheckpointsStore.js';

export type SettingsTabId =
  | 'providers'
  | 'permissions'
  | 'context'
  | 'checkpoints'
  | 'memory'
  | 'about';

export type SecondaryPanel = 'settings' | 'checkpoints' | 'inspector' | 'review';

interface ReviewPanelOpts {
  conversationId?: string;
  workspaceId?: string;
  filePath?: string;
}

/** Panel-specific widths tuned to content density. */
export const SECONDARY_ZONE_WIDTH: Record<SecondaryPanel, string> = {
  settings: 'min(480px,42vw)',
  checkpoints: 'min(400px,36vw)',
  inspector: 'min(480px,40vw)',
  review: 'min(520px,44vw)'
};

interface SecondaryZoneStore {
  panel: SecondaryPanel | null;
  settingsTab: SettingsTabId;
  reviewOpts: ReviewPanelOpts | null;
  openSettings: (tab?: SettingsTabId) => void;
  openCheckpoints: () => void;
  /** Opens the inspector panel and loads data for the bound id. */
  openInspector: (id: string, mode?: 'live' | 'idle') => void;
  /** Opens the review drawer for pending / PR metadata review. */
  openReview: (opts?: ReviewPanelOpts) => void;
  /** Remember the last settings tab the user viewed. */
  setSettingsTab: (tab: SettingsTabId) => void;
  close: () => void;
}

function closeInspectorIfOpen(panel: SecondaryPanel | null): void {
  if (panel === 'inspector') {
    useContextSummaryStore.getState().close();
  }
}

export const useSecondaryZoneStore = create<SecondaryZoneStore>((set, get) => ({
  panel: null,
  settingsTab: 'providers',
  reviewOpts: null,
  openSettings: (tab?: SettingsTabId) => {
    closeInspectorIfOpen(get().panel);
    const nextTab = tab ?? get().settingsTab;
    set({ panel: 'settings', settingsTab: nextTab, reviewOpts: null });
  },
  openCheckpoints: () => {
    closeInspectorIfOpen(get().panel);
    set({ panel: 'checkpoints', reviewOpts: null });
  },
  openInspector: (id, mode = 'idle') => {
    set({ panel: 'inspector', reviewOpts: null });
    void useContextSummaryStore.getState().open(id, mode);
  },
  openReview: (opts) => {
    closeInspectorIfOpen(get().panel);
    set({ panel: 'review', reviewOpts: opts ?? null });
    const cid = opts?.conversationId;
    const wsId = opts?.workspaceId;
    if (cid) {
      void useCheckpointsStore.getState().refreshPending(cid);
      if (wsId) void useCheckpointsStore.getState().refreshReview(cid, wsId);
    }
  },
  setSettingsTab: (tab) => {
    set({ settingsTab: tab });
  },
  close: () => {
    const { panel } = get();
    set({ panel: null, reviewOpts: null });
    if (panel === 'inspector') {
      useContextSummaryStore.getState().close();
    }
  }
}));
