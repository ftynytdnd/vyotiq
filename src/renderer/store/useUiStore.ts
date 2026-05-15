/**
 * UI store — small per-renderer slice for global UI toggles (e.g. sidebar
 * visibility). Keeps app-level state out of component trees so any feature
 * (TitleBar menus, keyboard shortcuts, etc.) can flip them.
 *
 * Sidebar visibility is persisted via the settings IPC. `hydrate` is called
 * once at boot from `App.tsx` after `useSettingsStore.refresh()` resolves;
 * subsequent toggles fire-and-forget a settings patch so state survives a
 * restart. The persistence call is intentionally not awaited so a slow disk
 * never delays UI feedback.
 *
 * F-016: persistence is debounced (`PERSIST_DEBOUNCE_MS`) so a user
 * rapidly clicking the sidebar toggle or expanding/collapsing many
 * workspace entries in sequence coalesces into one settings.json write
 * per affected key. The flusher is exposed via `flushUiPersistence` and
 * wired to `beforeunload` in `App.tsx` so a fast Cmd+Q before the
 * debounce fires still persists the latest values.
 */

import { create } from 'zustand';
import { vyotiq } from '../lib/ipc.js';

/**
 * Debounce window for sidebar / collapsed-workspaces persisters.
 * 200ms swallows a click-storm without making the persisted value
 * lag noticeably behind a single deliberate toggle.
 */
const PERSIST_DEBOUNCE_MS = 200;

let sidebarPersistTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSidebarOpen: boolean | null = null;

let collapsedPersistTimer: ReturnType<typeof setTimeout> | null = null;
let pendingCollapsed: Set<string> | null = null;

function flushSidebarOpenNow(): void {
  if (sidebarPersistTimer !== null) {
    clearTimeout(sidebarPersistTimer);
    sidebarPersistTimer = null;
  }
  if (pendingSidebarOpen === null) return;
  const next = pendingSidebarOpen;
  pendingSidebarOpen = null;
  void vyotiq.settings.set({ ui: { sidebarOpen: next } }).catch(() => {
    /* noop */
  });
}

function flushCollapsedNow(): void {
  if (collapsedPersistTimer !== null) {
    clearTimeout(collapsedPersistTimer);
    collapsedPersistTimer = null;
  }
  if (pendingCollapsed === null) return;
  const next = pendingCollapsed;
  pendingCollapsed = null;
  void vyotiq.settings
    .set({ ui: { collapsedWorkspaces: Array.from(next) } })
    .catch(() => {
      /* noop */
    });
}

/**
 * Public flush hook. Wire to `beforeunload` so a Cmd+Q during the
 * debounce window persists the latest values rather than losing them.
 */
export function flushUiPersistence(): void {
  flushSidebarOpenNow();
  flushCollapsedNow();
}

interface UiStore {
  sidebarOpen: boolean;
  /**
   * Per-workspace collapsed flag for the sidebar's workspace tree.
   * Open is the default — absence in this set means "expanded". Keyed
   * by `WorkspaceEntry.id`. Persisted under
   * `AppSettings.ui.collapsedWorkspaces` via the same fire-and-forget
   * pattern as `sidebarOpen`.
   */
  collapsedWorkspaces: Set<string>;
  /** True once `hydrate` has been called; suppresses persistence before then. */
  hydrated: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  /** Toggle a workspace's collapse state in the sidebar tree. */
  toggleWorkspaceCollapsed: (workspaceId: string) => void;
  clearWorkspaceCollapsed: (workspaceId: string) => void;
  /** Initialize from persisted AppSettings.ui at boot. */
  hydrate: (init: { sidebarOpen: boolean; collapsedWorkspaces?: string[] }) => void;
}

function persistSidebarOpen(open: boolean): void {
  // F-016: schedule, don't fire. The flusher coalesces a click-storm
  // into a single IPC. Errors inside the flusher are swallowed so a
  // transient settings.json write failure can't break the UI.
  pendingSidebarOpen = open;
  if (sidebarPersistTimer !== null) clearTimeout(sidebarPersistTimer);
  sidebarPersistTimer = setTimeout(flushSidebarOpenNow, PERSIST_DEBOUNCE_MS);
}

function persistCollapsedWorkspaces(set: Set<string>): void {
  // F-016: clone the set into the pending slot so subsequent in-place
  // mutations of the caller's set (the store keeps building new ones,
  // but defensive) cannot retroactively change the value we'd persist.
  pendingCollapsed = new Set(set);
  if (collapsedPersistTimer !== null) clearTimeout(collapsedPersistTimer);
  collapsedPersistTimer = setTimeout(flushCollapsedNow, PERSIST_DEBOUNCE_MS);
}

export const useUiStore = create<UiStore>((set, get) => ({
  sidebarOpen: true,
  collapsedWorkspaces: new Set<string>(),
  hydrated: false,
  toggleSidebar: () => {
    const next = !get().sidebarOpen;
    set({ sidebarOpen: next });
    if (get().hydrated) persistSidebarOpen(next);
  },
  setSidebarOpen: (open) => {
    if (get().sidebarOpen === open) return;
    set({ sidebarOpen: open });
    if (get().hydrated) persistSidebarOpen(open);
  },
  toggleWorkspaceCollapsed: (workspaceId) => {
    const current = get().collapsedWorkspaces;
    const next = new Set(current);
    if (next.has(workspaceId)) next.delete(workspaceId);
    else next.add(workspaceId);
    set({ collapsedWorkspaces: next });
    if (get().hydrated) persistCollapsedWorkspaces(next);
  },
  clearWorkspaceCollapsed: (workspaceId) => {
    const current = get().collapsedWorkspaces;
    if (!current.has(workspaceId)) return;
    const next = new Set(current);
    next.delete(workspaceId);
    set({ collapsedWorkspaces: next });
    if (get().hydrated) persistCollapsedWorkspaces(next);
  },
  hydrate: ({ sidebarOpen, collapsedWorkspaces }) =>
    set({
      sidebarOpen,
      collapsedWorkspaces: new Set(collapsedWorkspaces ?? []),
      hydrated: true
    })
}));
