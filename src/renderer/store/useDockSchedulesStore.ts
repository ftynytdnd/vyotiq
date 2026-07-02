/**
 * Dock scheduled-runs popover open state (titlebar toolbar).
 */

import { create } from 'zustand';

interface DockSchedulesStore {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

export const useDockSchedulesStore = create<DockSchedulesStore>((set, get) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set({ open: !get().open })
}));
