/**
 * UI store — small per-renderer slice for global UI toggles (e.g. left
 * dock visibility). Keeps app-level state out of component trees so any
 * feature (TitleBar menus, keyboard shortcuts, etc.) can flip them.
 *
 * Dock expansion and width are persisted via the settings IPC. `hydrate`
 * is called once at boot from `App.tsx` after `useSettingsStore.refresh()`
 * resolves; subsequent toggles fire-and-forget a settings patch so state
 * survives a restart.
 */

import { create } from 'zustand';
import { vyotiq } from '../lib/ipc.js';
import { clampDockWidth, DOCK_WIDTH_DEFAULT } from '@shared/dock/dockWidth.js';

const PERSIST_DEBOUNCE_MS = 200;

let dockPersistTimer: ReturnType<typeof setTimeout> | null = null;
let pendingDockExpanded: boolean | null = null;

let dockWidthPersistTimer: ReturnType<typeof setTimeout> | null = null;
let pendingDockWidth: number | null = null;

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

function flushDockWidthNow(): void {
  if (dockWidthPersistTimer !== null) {
    clearTimeout(dockWidthPersistTimer);
    dockWidthPersistTimer = null;
  }
  if (pendingDockWidth === null) return;
  const next = pendingDockWidth;
  pendingDockWidth = null;
  void vyotiq.settings.set({ ui: { dockWidth: next } }).catch(() => {
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

export function flushUiPersistence(): void {
  flushDockExpandedNow();
  flushDockWidthNow();
  flushCollapsedNow();
}

interface UiStore {
  dockExpanded: boolean;
  dockWidth: number;
  collapsedWorkspaces: Set<string>;
  hydrated: boolean;
  toggleDock: () => void;
  setDockExpanded: (expanded: boolean) => void;
  setDockWidth: (width: number) => void;
  toggleWorkspaceCollapsed: (workspaceId: string) => void;
  clearWorkspaceCollapsed: (workspaceId: string) => void;
  hydrate: (init: {
    dockExpanded: boolean;
    dockWidth?: number;
    collapsedWorkspaces?: string[];
  }) => void;
}

function persistDockExpanded(expanded: boolean): void {
  pendingDockExpanded = expanded;
  if (dockPersistTimer !== null) clearTimeout(dockPersistTimer);
  dockPersistTimer = setTimeout(flushDockExpandedNow, PERSIST_DEBOUNCE_MS);
}

function persistDockWidth(width: number): void {
  pendingDockWidth = width;
  if (dockWidthPersistTimer !== null) clearTimeout(dockWidthPersistTimer);
  dockWidthPersistTimer = setTimeout(flushDockWidthNow, PERSIST_DEBOUNCE_MS);
}

function persistCollapsedWorkspaces(set: Set<string>): void {
  pendingCollapsed = new Set(set);
  if (collapsedPersistTimer !== null) clearTimeout(collapsedPersistTimer);
  collapsedPersistTimer = setTimeout(flushCollapsedNow, PERSIST_DEBOUNCE_MS);
}

export const useUiStore = create<UiStore>((set, get) => ({
  dockExpanded: false,
  dockWidth: DOCK_WIDTH_DEFAULT,
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
  setDockWidth: (width) => {
    const next = clampDockWidth(width);
    if (get().dockWidth === next) return;
    set({ dockWidth: next });
    if (get().hydrated) persistDockWidth(next);
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
  hydrate: ({ dockExpanded, dockWidth, collapsedWorkspaces }) =>
    set({
      dockExpanded,
      dockWidth: clampDockWidth(dockWidth ?? DOCK_WIDTH_DEFAULT),
      collapsedWorkspaces: new Set(collapsedWorkspaces ?? []),
      hydrated: true
    })
}));
