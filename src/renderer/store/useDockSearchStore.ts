/**
 * Dock search slice — controls whether the inline search popover is open
 * and what the current query is. Lifted into its own store so keyboard
 * shortcuts can imperatively open and focus it from anywhere without
 * prop-drilling.
 *
 * Closing the search clears the query so a fresh activation never resurfaces
 * a stale filter.
 */

import { create } from 'zustand';

interface DockSearchStore {
  open: boolean;
  query: string;
  pendingTimelineScroll: { conversationId: string; eventId: string } | null;
  setOpen: (open: boolean) => void;
  setQuery: (query: string) => void;
  toggle: () => void;
  setPendingTimelineScroll: (target: { conversationId: string; eventId: string } | null) => void;
  consumePendingTimelineScroll: () => { conversationId: string; eventId: string } | null;
}

export const useDockSearchStore = create<DockSearchStore>((set, get) => ({
  open: false,
  query: '',
  pendingTimelineScroll: null,
  setOpen: (open) => set({ open, query: open ? get().query : '' }),
  setQuery: (query) => set({ query }),
  toggle: () => {
    const next = !get().open;
    set({ open: next, query: next ? get().query : '' });
  },
  setPendingTimelineScroll: (target) => set({ pendingTimelineScroll: target }),
  consumePendingTimelineScroll: () => {
    const target = get().pendingTimelineScroll;
    if (target) set({ pendingTimelineScroll: null });
    return target;
  }
}));
