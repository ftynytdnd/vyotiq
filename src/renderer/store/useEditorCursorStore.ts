/**
 * Lightweight cursor/selection state for the editor status bar. Kept
 * separate from `useEditorStore` so high-frequency cursor moves don't
 * re-render the editor document state.
 */

import { create } from 'zustand';

interface EditorCursorStore {
  line: number;
  col: number;
  /** Selected character count (0 when no selection). */
  selection: number;
  setCursor: (line: number, col: number, selection: number) => void;
  reset: () => void;
}

export const useEditorCursorStore = create<EditorCursorStore>((set) => ({
  line: 1,
  col: 1,
  selection: 0,
  setCursor: (line, col, selection) => set({ line, col, selection }),
  reset: () => set({ line: 1, col: 1, selection: 0 })
}));
