/**
 * Sidebar search slice — controls whether the inline search input is open
 * and what the current query is. Lifted into its own store so the keyboard
 * shortcut hook (`useSidebarShortcuts`) can imperatively open and focus it
 * from anywhere without prop-drilling.
 *
 * Closing the search clears the query so a fresh activation never resurfaces
 * a stale filter.
 */

import { create } from 'zustand';

interface SidebarSearchStore {
  open: boolean;
  query: string;
  setOpen: (open: boolean) => void;
  setQuery: (query: string) => void;
  toggle: () => void;
}

export const useSidebarSearchStore = create<SidebarSearchStore>((set, get) => ({
  open: false,
  query: '',
  setOpen: (open) => set({ open, query: open ? get().query : '' }),
  setQuery: (query) => set({ query }),
  toggle: () => {
    const next = !get().open;
    set({ open: next, query: next ? get().query : '' });
  }
}));
