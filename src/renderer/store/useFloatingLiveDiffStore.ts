import { create } from 'zustand';
import type { DiffStreamSnapshot } from '../components/timeline/reducer/types.js';
import { closeSettingsForCompanionOpen } from './useAppViewStore.js';

export interface FloatingLiveDiffTarget {
  callId: string;
  filePath: string;
  diffStream: DiffStreamSnapshot;
}

interface FloatingLiveDiffStore {
  target: FloatingLiveDiffTarget | null;
  userDismissedCallId: string | null;
  open: (target: FloatingLiveDiffTarget) => void;
  close: () => void;
  dismiss: (callId: string) => void;
}

export const useFloatingLiveDiffStore = create<FloatingLiveDiffStore>((set) => ({
  target: null,
  userDismissedCallId: null,
  open: (target) => {
    if (useFloatingLiveDiffStore.getState().userDismissedCallId === target.callId) return;
    closeSettingsForCompanionOpen();
    set({ target, userDismissedCallId: null });
  },
  close: () => set({ target: null }),
  dismiss: (callId) => set({ target: null, userDismissedCallId: callId })
}));
