import { create } from 'zustand';
import type { AppSettings } from '@shared/types/ipc.js';
import type { ModelSelection } from '@shared/types/provider.js';
import type { TurnUsageStatsDelta, WorkspaceSpendEntry } from '@shared/types/usageStats.js';
import { vyotiq } from '../lib/ipc.js';
import { logger } from '../lib/logger.js';

const log = logger.child('settings-store');

interface SettingsStore {
  settings: AppSettings;
  loading: boolean;
  /** Non-null when the last `refresh()` IPC call failed. */
  loadError: string | null;
  /** True after the first `refresh()` attempt completes (success or failure). */
  initialLoadDone: boolean;
  refresh: () => Promise<void>;
  setDefaultModel: (sel: ModelSelection) => Promise<void>;
  /**
   * Persist the per-workspace last-active conversation map. Called by
   * `useConversationsStore` after every `select` / `bindActive` /
   * `remove` so a restart restores the slot the user was last
   * viewing in each workspace.
   */
  setActiveConversationByWorkspace: (map: Record<string, string>) => Promise<void>;
  /**
   * Persist the last-used model for a single workspace. Called by
   * `useChatStore.send` after a successful send so a fresh chat in
   * the same workspace defaults to the model the user was just using.
   * Other workspaces' entries are left untouched.
   */
  setLastModelByWorkspace: (workspaceId: string, sel: ModelSelection) => Promise<void>;
  toggleFavoriteModel: (providerId: string, modelId: string) => Promise<void>;
  /** Accumulate workspace usage stats for a completed turn. */
  addWorkspaceUsage: (
    workspaceId: string,
    usd: number,
    stats?: TurnUsageStatsDelta
  ) => Promise<void>;
  /**
   * One-shot cascade triggered by `workspace.remove`. Strips the
   * given workspace id from every per-workspace UI map at once
   * (`activeConversationByWorkspace`, `lastModelByWorkspace`, and
   * `collapsedWorkspaces`, `filesExpandedWorkspaces`) so removed workspaces don't leave orphaned
   * entries in `settings.json` forever.
   */
  purgeWorkspaceFromUi: (workspaceId: string) => Promise<void>;
}

/** Gate UI hydration until disk settings have been read at least once. */
export function selectSettingsReady(state: Pick<SettingsStore, 'loading' | 'initialLoadDone'>): boolean {
  return state.initialLoadDone && !state.loading;
}

/**
 * Stable empty fallbacks for Zustand selectors. Inline `?? []` / `?? {}`
 * allocates a fresh reference every render; `useSyncExternalStore` treats
 * that as a change, `forceStoreRerender` schedules another pass, and React
 * eventually bails with error #185.
 */
export const EMPTY_FAVORITE_MODELS: readonly string[] = Object.freeze([]);
export const EMPTY_LAST_MODEL_BY_WORKSPACE: Readonly<Record<string, ModelSelection>> =
  Object.freeze({});
export const EMPTY_WORKSPACE_SPEND_USD: Readonly<Record<string, WorkspaceSpendEntry>> =
  Object.freeze({});

export const useSettingsStore = create<SettingsStore>((setState, getState) => ({
  settings: {},
  loading: false,
  loadError: null,
  initialLoadDone: false,

  refresh: async () => {
    setState({ loading: true });
    try {
      const settings = await vyotiq.settings.get();
      setState({
        settings,
        loading: false,
        loadError: null,
        initialLoadDone: true
      });
    } catch (err) {
      // F-014: the pre-fix code left `loading: true` stuck on state
      // forever when the IPC rejected (transient main-process issue,
      // malformed settings.json, encrypted-store unlock failure). All
      // other stores in this folder try/catch their `refresh`; align.
      // Settings are optional — the pre-existing defaults in
      // `settings` state remain usable so the UI renders normally;
      // the next successful `refresh` (e.g. user hits Settings again)
      // repopulates.
      const message = err instanceof Error ? err.message : String(err);
      log.error('settings.get failed; keeping defaults', { err });
      setState({ loading: false, loadError: message, initialLoadDone: true });
    }
  },

  setDefaultModel: async (sel) => {
    const updated = await vyotiq.settings.set({ defaultModel: sel });
    setState({ settings: { ...getState().settings, ...updated } });
  },

  setActiveConversationByWorkspace: async (map) => {
    const updated = await vyotiq.settings.set({
      ui: { activeConversationByWorkspace: map }
    });
    setState({ settings: { ...getState().settings, ...updated } });
  },

  purgeWorkspaceFromUi: async (workspaceId) => {
    const current = getState().settings;
    const ui = current.ui ?? {};
    const active = ui.activeConversationByWorkspace ?? {};
    const lastModel = ui.lastModelByWorkspace ?? {};
    const collapsed = ui.collapsedWorkspaces ?? [];
    const filesExpanded = ui.filesExpandedWorkspaces ?? [];
    const spend = ui.workspaceSpendUsd ?? {};
    const fileTreeExpanded = ui.fileTreeExpandedByWorkspace ?? {};
    const editorTabs = ui.editorTabsByWorkspace ?? {};
    const inAny =
      workspaceId in active ||
      workspaceId in lastModel ||
      workspaceId in spend ||
      workspaceId in fileTreeExpanded ||
      workspaceId in editorTabs ||
      collapsed.includes(workspaceId) ||
      filesExpanded.includes(workspaceId);
    if (!inAny) return;
    // Build cleaned copies. Spread + delete keeps the other entries
    // intact so a parallel `setActiveConversationByWorkspace(...)` for a
    // different workspace doesn't race-clobber unrelated ids. The
    // collapsed-workspaces array is filtered immutably for the same
    // reason — a concurrent toggleWorkspaceCollapsed must see its own
    // value preserved on the next read.
    const nextActive = { ...active };
    delete nextActive[workspaceId];
    const nextLastModel = { ...lastModel };
    delete nextLastModel[workspaceId];
    const nextSpend = { ...spend };
    delete nextSpend[workspaceId];
    const nextCollapsed = collapsed.filter((id) => id !== workspaceId);
    const nextFilesExpanded = filesExpanded.filter((id) => id !== workspaceId);
    const nextFileTreeExpanded = { ...fileTreeExpanded };
    delete nextFileTreeExpanded[workspaceId];
    const nextEditorTabs = { ...editorTabs };
    delete nextEditorTabs[workspaceId];
    const updated = await vyotiq.settings.set({
      ui: {
        activeConversationByWorkspace: nextActive,
        lastModelByWorkspace: nextLastModel,
        workspaceSpendUsd: nextSpend,
        collapsedWorkspaces: nextCollapsed,
        filesExpandedWorkspaces: nextFilesExpanded,
        fileTreeExpandedByWorkspace: nextFileTreeExpanded,
        editorTabsByWorkspace: nextEditorTabs
      }
    });
    setState({ settings: { ...getState().settings, ...updated } });
  },

  setLastModelByWorkspace: async (workspaceId, sel) => {
    const current = getState().settings;
    const prev = current.ui?.lastModelByWorkspace ?? {};
    // Merge into the existing per-workspace map; other entries
    // untouched. Identity-skip when the value is unchanged so we don't
    // churn settings.json on every keystroke send during the same
    // model selection.
    const existing = prev[workspaceId];
    if (
      existing &&
      existing.providerId === sel.providerId &&
      existing.modelId === sel.modelId
    ) {
      return;
    }
    const next = { ...prev, [workspaceId]: { providerId: sel.providerId, modelId: sel.modelId } };
    const updated = await vyotiq.settings.set({
      ui: { lastModelByWorkspace: next }
    });
    setState({ settings: { ...getState().settings, ...updated } });
  },

  toggleFavoriteModel: async (providerId, modelId) => {
    const current = getState().settings;
    const key = `${providerId}::${modelId}`;
    const prev = current.ui?.favoriteModels ?? [];
    const set = new Set(prev);
    if (set.has(key)) set.delete(key);
    else set.add(key);
    const updated = await vyotiq.settings.set({
      ui: { favoriteModels: [...set] }
    });
    setState({ settings: { ...getState().settings, ...updated } });
  },

  addWorkspaceUsage: async (workspaceId, usd, stats = {}) => {
    if (!Number.isFinite(usd) || usd <= 0) return;
    const updated = await vyotiq.settings.set({
      ui: {
        workspaceUsageIncrement: {
          [workspaceId]: { spendUsd: usd, ...stats }
        }
      }
    });
    setState({ settings: { ...getState().settings, ...updated } });
  }
}));
