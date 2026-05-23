/**
 * UI store — small per-renderer slice for global UI toggles (e.g. bottom
 * dock visibility). Keeps app-level state out of component trees so any
 * feature (TitleBar menus, keyboard shortcuts, etc.) can flip them.
 *
 * Dock expansion is persisted via the settings IPC. `hydrate` is called
 * once at boot from `App.tsx` after `useSettingsStore.refresh()` resolves;
 * subsequent toggles fire-and-forget a settings patch so state survives a
 * restart. The persistence call is intentionally not awaited so a slow disk
 * never delays UI feedback.
 *
 * F-016: persistence is debounced (`PERSIST_DEBOUNCE_MS`) so a user
 * rapidly toggling the dock or expanding/collapsing many workspace entries
 * in sequence coalesces into one settings.json write per affected key. The
 * flusher is exposed via `flushUiPersistence` and wired to `beforeunload`
 * in `App.tsx` so a fast Cmd+Q before the debounce fires still persists
 * the latest values.
 */

import { create } from 'zustand';
import { vyotiq } from '../lib/ipc.js';

/**
 * Debounce window for dock / collapsed-workspaces persisters.
 * 200ms swallows a click-storm without making the persisted value
 * lag noticeably behind a single deliberate toggle.
 */
const PERSIST_DEBOUNCE_MS = 200;

let dockPersistTimer: ReturnType<typeof setTimeout> | null = null;
let pendingDockExpanded: boolean | null = null;

let collapsedPersistTimer: ReturnType<typeof setTimeout> | null = null;
let pendingCollapsed: Set<string> | null = null;

function flushDockExpandedNow(): void {
  if (dockPersistTimer !== null) {
    clearTimeout(dockPersistTimer);
    dockPersistTimer = null;
  }
  if (pendingDockExpanded === null) return;
  const next = pendingDockExpanded;
  pendingDockExpanded = null;
  void vyotiq.settings.set({ ui: { dockExpanded: next } }).catch(() => {
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
  flushDockExpandedNow();
  flushCollapsedNow();
}

interface UiStore {
  dockExpanded: boolean;
  /**
   * Per-workspace collapsed flag for workspace groups in the dock.
   * Open is the default — absence in this set means "expanded". Keyed
   * by `WorkspaceEntry.id`. Persisted under
   * `AppSettings.ui.collapsedWorkspaces` via the same fire-and-forget
   * pattern as `dockExpanded`.
   */
  collapsedWorkspaces: Set<string>;
  /** True once `hydrate` has been called; suppresses persistence before then. */
  hydrated: boolean;
  toggleDock: () => void;
  setDockExpanded: (expanded: boolean) => void;
  /** Toggle a workspace's collapse state in the dock tree. */
  toggleWorkspaceCollapsed: (workspaceId: string) => void;
  clearWorkspaceCollapsed: (workspaceId: string) => void;
  /** Initialize from persisted AppSettings.ui at boot. */
  hydrate: (init: { dockExpanded: boolean; collapsedWorkspaces?: string[] }) => void;
}

function persistDockExpanded(expanded: boolean): void {
  pendingDockExpanded = expanded;
  if (dockPersistTimer !== null) clearTimeout(dockPersistTimer);
  dockPersistTimer = setTimeout(flushDockExpandedNow, PERSIST_DEBOUNCE_MS);
}

function persistCollapsedWorkspaces(set: Set<string>): void {
  pendingCollapsed = new Set(set);
  if (collapsedPersistTimer !== null) clearTimeout(collapsedPersistTimer);
  collapsedPersistTimer = setTimeout(flushCollapsedNow, PERSIST_DEBOUNCE_MS);
}

export const useUiStore = create<UiStore>((set, get) => ({
  dockExpanded: false,
  collapsedWorkspaces: new Set<string>(),
  hydrated: false,
  toggleDock: () => {
    const next = !get().dockExpanded;
    set({ dockExpanded: next });
    if (get().hydrated) persistDockExpanded(next);
  },
  setDockExpanded: (expanded) => {
    if (get().dockExpanded === expanded) return;
    set({ dockExpanded: expanded });
    if (get().hydrated) persistDockExpanded(expanded);
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
  hydrate: ({ dockExpanded, collapsedWorkspaces }) =>
    set({
      dockExpanded,
      collapsedWorkspaces: new Set(collapsedWorkspaces ?? []),
      hydrated: true
    })
}));
