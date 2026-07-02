/**
 * Bridge settings authoring flows to the chat composer model picker.
 */

import { create } from 'zustand';

interface ComposerModelBridgeState {
  /** Bumped when harness/skills panels open to apply authoring model to composer. */
  authoringEditNonce: number;
  requestAuthoringModelForEdit: () => void;
}

export const useComposerModelBridgeStore = create<ComposerModelBridgeState>((set) => ({
  authoringEditNonce: 0,
  requestAuthoringModelForEdit: () =>
    set((s) => ({ authoringEditNonce: s.authoringEditNonce + 1 }))
}));
