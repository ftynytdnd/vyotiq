/**
 * Source control companion pane open state.
 */

import { create } from 'zustand';
import { closeSettingsForCompanionOpen } from './useAppViewStore.js';
import {
  focusWorkbenchTab,
  syncWorkbenchTabAfterClose
} from '../components/workbench/workbenchShared.js';
import { focusActiveWorkbenchDom } from '../lib/workbenchFocusDom.js';
import { useUiStore } from './useUiStore.js';

interface SourceControlStore {
  open: boolean;
  workspaceId: string | null;
  openPanel: (workspaceId: string) => void;
  toggle: (workspaceId: string | null) => void;
  close: () => void;
}

export const useSourceControlStore = create<SourceControlStore>((set, get) => ({
  open: false,
  workspaceId: null,

  openPanel: (workspaceId) => {
    closeSettingsForCompanionOpen();
    focusWorkbenchTab('source-control');
    set({ open: true, workspaceId });
    focusActiveWorkbenchDom('source-control');
  },

  toggle: (workspaceId) => {
    if (!workspaceId) return;
    const { open, workspaceId: currentWs } = get();
    if (open && currentWs === workspaceId) {
      if (useUiStore.getState().workbenchTab === 'source-control') {
        get().close();
        return;
      }
      focusWorkbenchTab('source-control');
      focusActiveWorkbenchDom('source-control');
      return;
    }
    get().openPanel(workspaceId);
  },

  close: () => {
    set({ open: false, workspaceId: null });
    syncWorkbenchTabAfterClose();
  }
}));
