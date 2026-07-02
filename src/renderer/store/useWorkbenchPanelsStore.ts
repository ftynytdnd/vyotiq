/**
 * Workbench companion-panels menu — keyboard shortcut can open imperatively.
 */

import { create } from 'zustand';

interface WorkbenchPanelsStore {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

export const useWorkbenchPanelsStore = create<WorkbenchPanelsStore>((set, get) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set({ open: !get().open })
}));
