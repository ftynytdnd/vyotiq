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
import { persistSettingsPatch } from '../lib/persistSettingsPatch.js';
import { clampDockWidth, DOCK_WIDTH_DEFAULT } from '@shared/dock/dockWidth.js';
import {
  clampWorkbenchPaneWidth,
  WORKBENCH_PANE_WIDTH_DEFAULT
} from '@shared/workbench/workbenchPaneWidth.js';
import type { DockPanelTab } from '../components/dock/dockShared.js';
import type { WorkbenchTab } from '../components/workbench/workbenchShared.js';
import { useWorkspaceStore } from './useWorkspaceStore.js';

const PERSIST_DEBOUNCE_MS = 200;

let dockPersistTimer: ReturnType<typeof setTimeout> | null = null;
let pendingDockExpanded: boolean | null = null;

let dockWidthPersistTimer: ReturnType<typeof setTimeout> | null = null;
let pendingDockWidth: number | null = null;

let workbenchPaneWidthPersistTimer: ReturnType<typeof setTimeout> | null = null;
let pendingWorkbenchPaneWidth: number | null = null;

let collapsedPersistTimer: ReturnType<typeof setTimeout> | null = null;
let pendingCollapsed: Set<string> | null = null;

let filesExpandedPersistTimer: ReturnType<typeof setTimeout> | null = null;
let pendingFilesExpanded: Set<string> | null = null;

function flushDockExpandedNow(): Promise<void> {
  if (dockPersistTimer !== null) {
    clearTimeout(dockPersistTimer);
    dockPersistTimer = null;
  }
  if (pendingDockExpanded === null) return Promise.resolve();
  const next = pendingDockExpanded;
  pendingDockExpanded = null;
  return persistSettingsPatch({ ui: { dockExpanded: next } })
    .then(() => undefined)
    .catch(() => undefined);
}

function flushDockWidthNow(): Promise<void> {
  if (dockWidthPersistTimer !== null) {
    clearTimeout(dockWidthPersistTimer);
    dockWidthPersistTimer = null;
  }
  if (pendingDockWidth === null) return Promise.resolve();
  const next = pendingDockWidth;
  pendingDockWidth = null;
  return persistSettingsPatch({ ui: { dockWidth: next } })
    .then(() => undefined)
    .catch(() => undefined);
}

function flushWorkbenchPaneWidthNow(): Promise<void> {
  if (workbenchPaneWidthPersistTimer !== null) {
    clearTimeout(workbenchPaneWidthPersistTimer);
    workbenchPaneWidthPersistTimer = null;
  }
  if (pendingWorkbenchPaneWidth === null) return Promise.resolve();
  const next = pendingWorkbenchPaneWidth;
  pendingWorkbenchPaneWidth = null;
  return persistSettingsPatch({ ui: { workbenchPaneWidth: next } })
    .then(() => undefined)
    .catch(() => undefined);
}

function flushCollapsedNow(): Promise<void> {
  if (collapsedPersistTimer !== null) {
    clearTimeout(collapsedPersistTimer);
    collapsedPersistTimer = null;
  }
  if (pendingCollapsed === null) return Promise.resolve();
  const next = pendingCollapsed;
  pendingCollapsed = null;
  return persistSettingsPatch({ ui: { collapsedWorkspaces: Array.from(next) } })
    .then(() => undefined)
    .catch(() => undefined);
}

function flushFilesExpandedNow(): Promise<void> {
  if (filesExpandedPersistTimer !== null) {
    clearTimeout(filesExpandedPersistTimer);
    filesExpandedPersistTimer = null;
  }
  if (pendingFilesExpanded === null) return Promise.resolve();
  const next = pendingFilesExpanded;
  pendingFilesExpanded = null;
  return persistSettingsPatch({ ui: { filesExpandedWorkspaces: Array.from(next) } })
    .then(() => undefined)
    .catch(() => undefined);
}

export function flushUiPersistence(): Promise<void> {
  return Promise.all([
    flushDockExpandedNow(),
    flushDockWidthNow(),
    flushWorkbenchPaneWidthNow(),
    flushCollapsedNow(),
    flushFilesExpandedNow()
  ]).then(() => {});
}

export type { DockPanelTab } from '../components/dock/dockShared.js';
export type { WorkbenchTab } from '../components/workbench/workbenchShared.js';

interface UiStore {
  dockExpanded: boolean;
  dockWidth: number;
  workbenchPaneWidth: number;
  dockPanelTab: DockPanelTab;
  workbenchTab: WorkbenchTab;
  collapsedWorkspaces: Set<string>;
  /** Workspace ids whose dock Files panel is expanded. */
  filesExpandedWorkspaces: Set<string>;
  hydrated: boolean;
  toggleDock: () => void;
  setDockExpanded: (expanded: boolean) => void;
  setDockWidth: (width: number) => void;
  setWorkbenchPaneWidth: (width: number) => void;
  setDockPanelTab: (tab: DockPanelTab) => void;
  setWorkspaceFilesExpanded: (workspaceId: string, expanded: boolean) => void;
  toggleWorkspaceFilesExpanded: (workspaceId: string) => void;
  setWorkbenchTab: (tab: WorkbenchTab) => void;
  toggleWorkspaceCollapsed: (workspaceId: string) => void;
  clearWorkspaceCollapsed: (workspaceId: string) => void;
  clearWorkspaceFilesExpanded: (workspaceId: string) => void;
  hydrate: (init: {
    dockExpanded: boolean;
    dockWidth?: number;
    workbenchPaneWidth?: number;
    collapsedWorkspaces?: string[];
    filesExpandedWorkspaces?: string[];
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

function persistWorkbenchPaneWidth(width: number): void {
  pendingWorkbenchPaneWidth = width;
  if (workbenchPaneWidthPersistTimer !== null) clearTimeout(workbenchPaneWidthPersistTimer);
  workbenchPaneWidthPersistTimer = setTimeout(flushWorkbenchPaneWidthNow, PERSIST_DEBOUNCE_MS);
}

function persistCollapsedWorkspaces(set: Set<string>): void {
  pendingCollapsed = new Set(set);
  if (collapsedPersistTimer !== null) clearTimeout(collapsedPersistTimer);
  collapsedPersistTimer = setTimeout(flushCollapsedNow, PERSIST_DEBOUNCE_MS);
}

function persistFilesExpandedWorkspaces(set: Set<string>): void {
  pendingFilesExpanded = new Set(set);
  if (filesExpandedPersistTimer !== null) clearTimeout(filesExpandedPersistTimer);
  filesExpandedPersistTimer = setTimeout(flushFilesExpandedNow, PERSIST_DEBOUNCE_MS);
}

function syncDockPanelTabForWorkspace(
  set: (partial: Pick<UiStore, 'dockPanelTab'>) => void,
  get: () => UiStore,
  workspaceId: string
): void {
  const tab: DockPanelTab = get().filesExpandedWorkspaces.has(workspaceId) ? 'files' : 'chats';
  if (get().dockPanelTab !== tab) set({ dockPanelTab: tab });
}

export const useUiStore = create<UiStore>((set, get) => ({
  dockExpanded: false,
  dockWidth: DOCK_WIDTH_DEFAULT,
  workbenchPaneWidth: WORKBENCH_PANE_WIDTH_DEFAULT,
  dockPanelTab: 'chats',
  workbenchTab: 'agent',
  collapsedWorkspaces: new Set<string>(),
  filesExpandedWorkspaces: new Set<string>(),
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
  setWorkbenchPaneWidth: (width) => {
    const next = clampWorkbenchPaneWidth(width);
    if (get().workbenchPaneWidth === next) return;
    set({ workbenchPaneWidth: next });
    if (get().hydrated) persistWorkbenchPaneWidth(next);
  },
  setDockPanelTab: (tab) => {
    const activeId = useWorkspaceStore.getState().activeId;
    if (activeId) {
      get().setWorkspaceFilesExpanded(activeId, tab === 'files');
      return;
    }
    if (get().dockPanelTab === tab) return;
    set({ dockPanelTab: tab });
  },
  setWorkspaceFilesExpanded: (workspaceId, expanded) => {
    const current = get().filesExpandedWorkspaces;
    const has = current.has(workspaceId);
    if (expanded === has) return;
    const next = new Set(current);
    if (expanded) next.add(workspaceId);
    else next.delete(workspaceId);
    set({ filesExpandedWorkspaces: next });
    syncDockPanelTabForWorkspace(set, get, workspaceId);
    if (get().hydrated) persistFilesExpandedWorkspaces(next);
  },
  toggleWorkspaceFilesExpanded: (workspaceId) => {
    const expanded = !get().filesExpandedWorkspaces.has(workspaceId);
    get().setWorkspaceFilesExpanded(workspaceId, expanded);
  },
  setWorkbenchTab: (tab) => {
    if (get().workbenchTab === tab) return;
    set({ workbenchTab: tab });
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
  clearWorkspaceFilesExpanded: (workspaceId) => {
    const current = get().filesExpandedWorkspaces;
    if (!current.has(workspaceId)) return;
    const next = new Set(current);
    next.delete(workspaceId);
    set({ filesExpandedWorkspaces: next });
    if (get().hydrated) persistFilesExpandedWorkspaces(next);
  },
  hydrate: ({ dockExpanded, dockWidth, workbenchPaneWidth, collapsedWorkspaces, filesExpandedWorkspaces }) => {
    const filesExpanded = new Set(filesExpandedWorkspaces ?? []);
    const activeId = useWorkspaceStore.getState().activeId;
    const dockPanelTab: DockPanelTab =
      activeId && filesExpanded.has(activeId) ? 'files' : 'chats';
    set({
      dockExpanded,
      dockWidth: clampDockWidth(dockWidth ?? DOCK_WIDTH_DEFAULT),
      workbenchPaneWidth: clampWorkbenchPaneWidth(
        workbenchPaneWidth ?? WORKBENCH_PANE_WIDTH_DEFAULT
      ),
      collapsedWorkspaces: new Set(collapsedWorkspaces ?? []),
      filesExpandedWorkspaces: filesExpanded,
      dockPanelTab,
      hydrated: true
    });
  }
}));
