/**
 * Workspaces store. Owns the multi-workspace registry surfaced by main
 * (`vyotiq.workspace.list / add / setActive / rename / remove`) plus a
 * derived `info` slot kept around so existing single-workspace
 * selectors (`s.info`, `s.pick()`, `s.set()`) continue to compile and
 * behave identically — they read/write the active entry.
 *
 * The registry shape is intentionally minimal: full list + active id +
 * a derived `info`. The left navigation dock filters conversations against
 * each workspace's id; the title-bar / Composer / picker continue to
 * read `s.info` and never need to know about the registry.
 */

import { create } from 'zustand';
import type { WorkspaceEntry, WorkspaceInfo } from '@shared/types/ipc.js';
import { vyotiq } from '../lib/ipc.js';
import { logger } from '../lib/logger.js';
import { invalidateWorkspaceTreeCache } from '../lib/workspaceTreeCache.js';
import { disposeLspClient } from '../lib/lspWorkspaceClient.js';
import { useToastStore } from './useToastStore.js';
import { useUiStore } from './useUiStore.js';
// `useConversationsStore` and `useSettingsStore` were previously
// dynamic-imported here to avoid a circular module graph at boot. With
// the renderer bundle now eager-loading the same stores from
// `App.tsx`/sibling components anyway (per the vite chunking
// warnings), the dynamic + static mix prevented Rollup from splitting
// either store into its own chunk and broke code-splitting for both.
// Static-import here is safe — the cycle is import-time inert
// (mutual exports only consume each other's `.getState()` at call
// time, not at module init), and matches every other use site.
import { useConversationsStore } from './useConversationsStore.js';
import { useSettingsStore } from './useSettingsStore.js';
import { cancelFileTreeExpandedPersist } from '../hooks/useFileTreeExpanded.js';
import { cancelEditorTabsPersist } from '../lib/editorTabsPersistence.js';

const log = logger.child('workspace-store');

interface WorkspaceStore {
  /** Full registry as returned by `workspace.list()`. */
  list: WorkspaceEntry[];
  /** Currently-active workspace id (mirrors main's `activeWorkspaceId`). */
  activeId: string | null;
  /**
   * Derived single-workspace summary of the active entry. Kept so
   * pre-multi-workspace selectors (`s.info.path`, `s.info.label`)
   * continue to work without churning every callsite.
   */
  info: WorkspaceInfo;
  loading: boolean;

  refresh: () => Promise<void>;
  /** Legacy "pick a workspace" — opens the picker via main. */
  pick: () => Promise<void>;
  /** Legacy "set workspace by path" — adds (or activates) the path. */
  set: (path: string) => Promise<void>;

  // ---- Registry surface ----------------------------------------------
  /**
   * Add a workspace. Without `path`, opens the OS picker via main and
   * resolves once the user has chosen (or cancelled, in which case
   * the returned promise resolves to `null`).
   */
  add: (path?: string) => Promise<WorkspaceEntry | null>;
  setActive: (id: string) => Promise<void>;
  rename: (id: string, label: string) => Promise<void>;
  remove: (id: string, opts: { deleteConversations: boolean }) => Promise<void>;
  /**
   * Re-stat a workspace's path. If the mount has come back, the
   * registry's `unreachable` flag clears and the dock's warning
   * chip disappears. Used by the per-group retry affordance.
   */
  retryReachability: (id: string) => Promise<void>;
}

function infoFromEntry(entry: WorkspaceEntry | undefined): WorkspaceInfo {
  return entry ? { path: entry.path, label: entry.label } : { path: null, label: null };
}

/**
 * Drop the renderer's workspace-tree cache whenever the resolved
 * active path changes. Mirrors the pre-multi-workspace invalidation
 * contract — the picker keys its cache by `(workspacePath, depth)`,
 * so a same-path re-activate is a no-op for the cache.
 */
function maybeInvalidate(prev: WorkspaceInfo, next: WorkspaceInfo): void {
  if (prev.path !== next.path) invalidateWorkspaceTreeCache();
}

export const useWorkspaceStore = create<WorkspaceStore>((setState, getState) => ({
  list: [],
  activeId: null,
  info: { path: null, label: null },
  loading: false,

  refresh: async () => {
    setState({ loading: true });
    try {
      const state = await vyotiq.workspace.list();
      const active = state.workspaces.find((w) => w.id === state.activeId);
      const info = infoFromEntry(active);
      maybeInvalidate(getState().info, info);
      setState({
        list: state.workspaces,
        activeId: state.activeId,
        info,
        loading: false
      });
    } catch (err) {
      log.error('workspace.list failed', { err });
      setState({ loading: false });
    }
  },

  pick: async () => {
    // Re-routes through `add()` so the legacy entry point produces a
    // registry entry rather than overwriting a single-workspace slot.
    // Treat picker cancellation as a no-op (no toast, no spinner stuck).
    await getState().add();
  },

  set: async (path) => {
    await getState().add(path);
  },

  add: async (path) => {
    setState({ loading: true });
    try {
      const entry = await vyotiq.workspace.add(path);
      if (!entry) {
        setState({ loading: false });
        return null;
      }
      // Optimistic registry update so the dock paints the new
      // group without waiting for the round-trip refresh. The main-
      // side `add` already activated the entry.
      const next = await vyotiq.workspace.list();
      const active = next.workspaces.find((w) => w.id === next.activeId);
      const info = infoFromEntry(active);
      maybeInvalidate(getState().info, info);
      setState({
        list: next.workspaces,
        activeId: next.activeId,
        info,
        loading: false
      });
      return entry;
    } catch (err) {
      log.error('workspace.add failed', { err });
      setState({ loading: false });
      throw err;
    }
  },

  setActive: async (id) => {
    const prev = getState();
    if (prev.activeId === id) return;
    // Optimistic flip: paint the new active workspace IMMEDIATELY.
    // The IPC awaits a settings.json disk write that on slow mounts
    // (OneDrive sync) can take hundreds of ms — without the optimism
    // the dock workspace highlight + the chat mirror's downstream
    // reactions would all stall behind that fsync. We mirror main's
    // post-condition (active entry → derived `info`) up-front and
    // roll back if the persistence call rejects.
    const target = prev.list.find((w) => w.id === id);
    if (!target) {
      log.warn('setActive ignored: unknown workspace id', { id });
      return;
    }
    const info = infoFromEntry(target);
    maybeInvalidate(prev.info, info);
    if (prev.activeId) disposeLspClient(prev.activeId);
    setState({ activeId: id, info });
    try {
      const next = await vyotiq.workspace.setActive(id);
      // Reconcile against main's authoritative response. The optimistic
      // flip already covers the common path; this just absorbs any
      // server-side reachability flag changes the server may have
      // refreshed in the same call.
      const active = next.workspaces.find((w) => w.id === next.activeId);
      const reconciledInfo = infoFromEntry(active);
      setState({
        list: next.workspaces,
        activeId: next.activeId,
        info: reconciledInfo
      });
    } catch (err) {
      log.error('workspace.setActive failed; rolling back optimistic flip', { err, id });
      // Roll back to whatever we showed BEFORE the optimistic flip so a
      // disk-write failure doesn't strand the dock advertising an
      // active workspace that was never persisted. F-012: NO second
      // `maybeInvalidate(info, prev.info)` here. The optimistic flip at
      // line 160 already invalidated the tree cache; on rollback the
      // previous workspace's tree is what should be re-fetched, and the
      // first invalidation already evacuated all entries. A second
      // invalidation pass is redundant work — the cache is already
      // empty for the prev workspace's keys.
      setState({ activeId: prev.activeId, info: prev.info });
      const msg = err instanceof Error ? err.message : String(err);
      useToastStore
        .getState()
        .show(`Could not switch workspace: ${msg}`, 'danger');
    }
  },

  rename: async (id, label) => {
    try {
      await vyotiq.workspace.rename(id, label);
      // Cheap full refresh — the registry is at most a handful of
      // entries so a list re-fetch is fine and keeps the slot
      // canonical.
      await getState().refresh();
    } catch (err) {
      log.error('workspace.rename failed', { err });
    }
  },

  remove: async (id, opts) => {
    try {
      const next = await vyotiq.workspace.remove(id, opts);
      const active = next.workspaces.find((w) => w.id === next.activeId);
      const info = infoFromEntry(active);
      maybeInvalidate(getState().info, info);
      setState({
        list: next.workspaces,
        activeId: next.activeId,
        info
      });
      useUiStore.getState().clearWorkspaceCollapsed(id);
      cancelFileTreeExpandedPersist(id);
      cancelEditorTabsPersist(id);
      await useConversationsStore.getState().reconcileWithMain();
      // Cascade: strip the removed workspace from every per-workspace
      // UI map (`activeConversationByWorkspace`, `lastModelByWorkspace`,
      // `permissionsByWorkspace`). Without this, a removed workspace's
      // entries leak forever in `settings.json` and an unrelated id
      // collision (re-adding a folder that produces the same id is
      // possible only via legacy migration paths, but the leaked
      // entries also bloat the blob over time).
      await useSettingsStore.getState().purgeWorkspaceFromUi(id);
    } catch (err) {
      log.error('workspace.remove failed', { err });
    }
  },

  retryReachability: async (id) => {
    try {
      const next = await vyotiq.workspace.retryReachability(id);
      const active = next.workspaces.find((w) => w.id === next.activeId);
      const info = infoFromEntry(active);
      // No tree-cache invalidation — the path itself didn't change;
      // only the `unreachable` flag flipped. The picker cache stays
      // valid by path.
      setState({
        list: next.workspaces,
        activeId: next.activeId,
        info
      });
    } catch (err) {
      log.error('workspace.retryReachability failed', { err, id });
    }
  }
}));
