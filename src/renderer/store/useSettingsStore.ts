import { create } from 'zustand';
import type { AppSettings } from '@shared/types/ipc.js';
import type { ModelSelection } from '@shared/types/provider.js';
import type { ChatPermissions } from '@shared/types/chat.js';
import { DEFAULT_PERMISSIONS } from '@shared/constants.js';
import { vyotiq } from '../lib/ipc.js';
import { logger } from '../lib/logger.js';

const log = logger.child('settings-store');

interface SettingsStore {
  settings: AppSettings;
  loading: boolean;
  refresh: () => Promise<void>;
  setDefaultModel: (sel: ModelSelection) => Promise<void>;
  setPermissions: (patch: Partial<ChatPermissions>) => Promise<void>;
  setWebSearchEndpoint: (endpoint: string) => Promise<void>;
  /**
   * Audit fix §2.2 — flip the opt-in transcript-aware summarizer.
   * When enabled, the run-loop falls back to a one-shot summarizer
   * LLM call after its structured trim policy can't fit the request
   * under the model's effective context window. The toggle takes
   * effect on the NEXT run (the loop snapshots the flag once at
   * start). Off by default for cost / determinism reasons.
   */
  setHistorySummaryEnabled: (enabled: boolean) => Promise<void>;
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
  /**
   * Persist a per-workspace permission override patch. Merges
   * `patch` into any existing override for the workspace; flags not
   * mentioned remain unset (and continue to fall through to the
   * global default in `selectEffectivePermissions`). Use
   * `clearWorkspacePermissions` to drop the entry entirely.
   */
  setPermissionsForWorkspace: (
    workspaceId: string,
    patch: Partial<ChatPermissions>
  ) => Promise<void>;
  /**
   * Drop a workspace's override entirely so the next send falls back
   * to the global `permissions` block. Used by the "Reset to global"
   * affordance in the per-workspace permissions menu.
   * No-op when the workspace has no override.
   */
  clearWorkspacePermissions: (workspaceId: string) => Promise<void>;
  /**
   * One-shot cascade triggered by `workspace.remove`. Strips the
   * given workspace id from every per-workspace UI map at once
   * (`activeConversationByWorkspace`, `lastModelByWorkspace`,
   * `permissionsByWorkspace`, `strictApprovalsByWorkspace`,
   * `gatePromptOnPendingByWorkspace`, and `collapsedWorkspaces`) so
   * removed workspaces don't leave orphaned entries in `settings.json`
   * forever. Persisted via a single IPC round-trip; concurrent updates
   * from individual setters see the post-purge state on their next
   * read. No-op when none of the maps mention the id.
   */
  purgeWorkspaceFromUi: (workspaceId: string) => Promise<void>;
  /**
   * Per-workspace strict-approvals toggle. When `true`, every `edit` /
   * `delete` tool call pauses the run and surfaces a full-diff approval
   * dialog before writing. Mirrors the per-workspace pattern used by
   * `setPermissionsForWorkspace` — identity-skips a same-value re-toggle
   * so a misclick that lands on the current value doesn't churn
   * settings.json. The flag is captured once per run by the orchestrator
   * (`AgentV.startRun`) so a toggle mid-run only takes effect on the
   * next send.
   */
  setStrictApprovalsForWorkspace: (
    workspaceId: string,
    value: boolean
  ) => Promise<void>;
  /**
   * Per-workspace "require pending changes to be resolved before sending
   * a new message" toggle. When `true`, `chat:send` rejects with
   * `{ ok: false, kind: 'pending-checkpoints' }` if the conversation has
   * unresolved pending entries. Identity-skips same-value re-toggles.
   * Read on the main side per-send by `chat.ipc` (see Plan §1, P0 fix
   * comment).
   */
  setGatePromptOnPendingForWorkspace: (
    workspaceId: string,
    value: boolean
  ) => Promise<void>;
}

/**
 * Resolve the EFFECTIVE permissions for a given workspace. Layered:
 *
 *   1. `DEFAULT_PERMISSIONS` (build-time default).
 *   2. `settings.permissions`               (user's global override).
 *   3. `settings.ui.permissionsByWorkspace[wsId]` (per-workspace override).
 *
 * Each layer is `Partial`, so a workspace that toggles only one flag
 * keeps every other flag inheriting from the global → default chain.
 *
 * `workspaceId === null` skips layer 3 — used during the brief boot
 * window before the renderer has resolved an active workspace, so the
 * composer doesn't need to special-case the "no workspace yet" state.
 */
export function selectEffectivePermissions(
  workspaceId: string | null,
  settings: AppSettings
): ChatPermissions {
  const global = settings.permissions ?? {};
  const wsOverride =
    workspaceId !== null
      ? settings.ui?.permissionsByWorkspace?.[workspaceId] ?? {}
      : {};
  return { ...DEFAULT_PERMISSIONS, ...global, ...wsOverride };
}

/**
 * Does the given workspace have ANY persisted permission override
 * (even if it happens to match the global)? Used by the menu to
 * decide whether to surface the "Reset to global" affordance and by
 * the Settings panel to render the per-workspace overrides list.
 */
export function workspaceHasPermissionOverride(
  workspaceId: string | null,
  settings: AppSettings
): boolean {
  if (workspaceId === null) return false;
  const entry = settings.ui?.permissionsByWorkspace?.[workspaceId];
  return entry !== undefined && Object.keys(entry).length > 0;
}

export const useSettingsStore = create<SettingsStore>((setState, getState) => ({
  settings: { permissions: DEFAULT_PERMISSIONS },
  loading: false,

  refresh: async () => {
    setState({ loading: true });
    try {
      const settings = await vyotiq.settings.get();
      setState({
        settings: {
          ...settings,
          permissions: { ...DEFAULT_PERMISSIONS, ...(settings.permissions ?? {}) }
        },
        loading: false
      });
    } catch (err) {
      // F-014: the pre-fix code left `loading: true` stuck on state
      // forever when the IPC rejected (transient main-process issue,
      // malformed settings.json, encrypted-store unlock failure). All
      // other stores in this folder try/catch their `refresh`; align.
      // Settings are optional — the pre-existing defaults in
      // `settings` state (DEFAULT_PERMISSIONS) remain usable so the UI
      // renders normally; the next successful `refresh` (e.g. user hits
      // Settings again) repopulates.
      log.error('settings.get failed; keeping defaults', { err });
      setState({ loading: false });
    }
  },

  setDefaultModel: async (sel) => {
    const updated = await vyotiq.settings.set({ defaultModel: sel });
    setState({ settings: { ...getState().settings, ...updated } });
  },

  setPermissions: async (patch) => {
    const current = getState().settings.permissions ?? DEFAULT_PERMISSIONS;
    const merged = { ...current, ...patch };
    const updated = await vyotiq.settings.set({ permissions: merged });
    setState({ settings: { ...getState().settings, ...updated } });
  },

  setWebSearchEndpoint: async (endpoint) => {
    const updated = await vyotiq.settings.set({ webSearchEndpoint: endpoint });
    setState({ settings: { ...getState().settings, ...updated } });
  },

  setHistorySummaryEnabled: async (enabled) => {
    // The wire shape is `{ historySummary: { enabled: boolean } }` so a
    // future addition (e.g. a max-tokens cap) can ride alongside without
    // breaking the toggle's call site. Identity-skip when the value
    // would be unchanged so a same-value click doesn't churn
    // settings.json.
    const current = getState().settings.historySummary?.enabled === true;
    if (current === enabled) return;
    const updated = await vyotiq.settings.set({ historySummary: { enabled } });
    setState({ settings: { ...getState().settings, ...updated } });
  },

  setActiveConversationByWorkspace: async (map) => {
    const current = getState().settings;
    const ui = { ...(current.ui ?? {}), activeConversationByWorkspace: map };
    const updated = await vyotiq.settings.set({ ui });
    setState({ settings: { ...getState().settings, ...updated } });
  },

  setPermissionsForWorkspace: async (workspaceId, patch) => {
    const current = getState().settings;
    const prev = current.ui?.permissionsByWorkspace ?? {};
    const existing = prev[workspaceId] ?? {};
    const merged = { ...existing, ...patch };
    // Identity-skip an empty merge so a same-value toggle (a misclick
    // that lands on the current state) doesn't churn settings.json.
    const sameKeys =
      Object.keys(merged).length === Object.keys(existing).length &&
      Object.entries(merged).every(
        ([k, v]) => (existing as Record<string, unknown>)[k] === v
      );
    if (sameKeys) return;
    const next = { ...prev, [workspaceId]: merged };
    const ui = { ...(current.ui ?? {}), permissionsByWorkspace: next };
    const updated = await vyotiq.settings.set({ ui });
    setState({ settings: { ...getState().settings, ...updated } });
  },

  clearWorkspacePermissions: async (workspaceId) => {
    const current = getState().settings;
    const prev = current.ui?.permissionsByWorkspace ?? {};
    if (!(workspaceId in prev)) return;
    const next = { ...prev };
    delete next[workspaceId];
    const ui = { ...(current.ui ?? {}), permissionsByWorkspace: next };
    const updated = await vyotiq.settings.set({ ui });
    setState({ settings: { ...getState().settings, ...updated } });
  },

  purgeWorkspaceFromUi: async (workspaceId) => {
    const current = getState().settings;
    const ui = current.ui ?? {};
    const active = ui.activeConversationByWorkspace ?? {};
    const lastModel = ui.lastModelByWorkspace ?? {};
    const perms = ui.permissionsByWorkspace ?? {};
    const strict = ui.strictApprovalsByWorkspace ?? {};
    const gate = ui.gatePromptOnPendingByWorkspace ?? {};
    const collapsed = ui.collapsedWorkspaces ?? [];
    const inAny =
      workspaceId in active ||
      workspaceId in lastModel ||
      workspaceId in perms ||
      workspaceId in strict ||
      workspaceId in gate ||
      collapsed.includes(workspaceId);
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
    const nextPerms = { ...perms };
    delete nextPerms[workspaceId];
    const nextStrict = { ...strict };
    delete nextStrict[workspaceId];
    const nextGate = { ...gate };
    delete nextGate[workspaceId];
    const nextCollapsed = collapsed.filter((id) => id !== workspaceId);
    const nextUi = {
      ...ui,
      activeConversationByWorkspace: nextActive,
      lastModelByWorkspace: nextLastModel,
      permissionsByWorkspace: nextPerms,
      strictApprovalsByWorkspace: nextStrict,
      gatePromptOnPendingByWorkspace: nextGate,
      collapsedWorkspaces: nextCollapsed
    };
    const updated = await vyotiq.settings.set({ ui: nextUi });
    setState({ settings: { ...getState().settings, ...updated } });
  },

  setStrictApprovalsForWorkspace: async (workspaceId, value) => {
    const current = getState().settings;
    const prev = current.ui?.strictApprovalsByWorkspace ?? {};
    // Identity-skip when the value would be unchanged — a misclick
    // that lands on the current state shouldn't churn settings.json.
    if ((prev[workspaceId] ?? false) === value) return;
    const next = { ...prev, [workspaceId]: value };
    const ui = { ...(current.ui ?? {}), strictApprovalsByWorkspace: next };
    const updated = await vyotiq.settings.set({ ui });
    setState({ settings: { ...getState().settings, ...updated } });
  },

  setGatePromptOnPendingForWorkspace: async (workspaceId, value) => {
    const current = getState().settings;
    const prev = current.ui?.gatePromptOnPendingByWorkspace ?? {};
    if ((prev[workspaceId] ?? false) === value) return;
    const next = { ...prev, [workspaceId]: value };
    const ui = { ...(current.ui ?? {}), gatePromptOnPendingByWorkspace: next };
    const updated = await vyotiq.settings.set({ ui });
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
    const ui = { ...(current.ui ?? {}), lastModelByWorkspace: next };
    const updated = await vyotiq.settings.set({ ui });
    setState({ settings: { ...getState().settings, ...updated } });
  }
}));
