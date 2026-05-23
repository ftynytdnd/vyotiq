/**
 * Renderer-side store for the Context Inspector panel.
 *
 * Owns:
 *   - The most recent `ContextInspectorSnapshot` for the run/
 *     conversation the Inspector is currently bound to.
 *   - The fully-resolved `ContextSummaryRules` for that workspace
 *     (matches what the orchestrator's auto-trigger uses).
 *   - The Inspector's open/closed UI state.
 *
 * Reads from `useChatStore` for live streaming bits
 * (`summaries`, `messageOverrides`) so the panel re-renders
 * smoothly without re-fetching on every delta. The IPC fetches
 * here are explicit-pull only:
 *   - `open(runIdOrConversationId)` pulls a fresh snapshot.
 *   - The IPC's `onSnapshotChanged(runId)` broadcast triggers a
 *     re-pull when the bound id matches.
 *   - `triggerManual` / `undo` / override toggles update the
 *     snapshot optimistically and re-pull on the broadcast.
 */

import { create } from 'zustand';
import type {
  ContextInspectorSnapshot,
  ContextMessageOverride,
  ContextSummaryRules
} from '@shared/types/contextSummary.js';
import { logger } from '../lib/logger.js';
import { vyotiq } from '../lib/ipc.js';
import { useChatStore } from './useChatStore.js';

const log = logger.child('useContextSummaryStore');

/**
 * Operating mode of the panel. The renderer uses this to switch
 * between the live-run vs. idle-conversation surfaces:
 *
 *   - `live`  — the bound id is a `runId` for a still-streaming
 *     orchestrator. Manual trigger / Undo are enabled. `summaries`
 *     in the chat store paints the live card.
 *   - `idle`  — the bound id is a `conversationId`; no orchestrator
 *     run is in flight. Manual trigger and cancel route through the
 *     idle summarizer runtime; undo works against persisted splices.
 *
 * Internal to this store; `open()` accepts the literal union
 * directly so external callers don't need to import the alias.
 */
type InspectorMode = 'live' | 'idle';

interface ContextSummaryState {
  /** What identifier `snapshot` was fetched against. `null` when closed. */
  boundId: string | null;
  mode: InspectorMode;
  /** Most recent fetched snapshot. `null` while pending or after
   *  a fetch failure. */
  snapshot: ContextInspectorSnapshot | null;
  /** Latest fully-resolved rules for the bound workspace. Cached
   *  here so the rules header re-renders without an IPC call on
   *  every panel open. */
  rules: ContextSummaryRules | null;
  /** True while the next IPC `inspect()` is in flight. */
  loading: boolean;
  /** Last fetch error message, when present. */
  error: string | null;
  /** Subscriber handle returned by
   *  `vyotiq.contextSummary.onSnapshotChanged`. We hold the
   *  unsubscribe so a panel-close path can release the listener
   *  without re-importing the API surface. */
  unsubscribe: (() => void) | null;
  /** Renderer-side guard: True while a manual trigger or undo
   *  IPC is in flight. The Inspector's "Summarize now" button
   *  disables itself while this is true. */
  busy: boolean;
}

interface ContextSummaryActions {
  /** Mount the panel for the given id. `mode` distinguishes live
   *  run vs. idle conversation surfaces. Subscribes to the
   *  snapshot-changed IPC broadcast for live mode. */
  open(id: string, mode: InspectorMode): Promise<void>;
  /** Close the panel and release the IPC subscription. */
  close(): void;
  /** Re-pull the snapshot for the currently bound id. No-op when
   *  the panel is closed. */
  refresh(): Promise<void>;
  /** Fire `vyotiq.contextSummary.triggerManual`. Re-pulls on
   *  success. Returns the IPC result so the UI can surface a
   *  toast on failure. */
  triggerManual(): Promise<
    | { ok: true; summaryId: string }
    | { ok: false; reason: string }
  >;
  /** Fire `vyotiq.contextSummary.undo`. Re-pulls on success. */
  undo(
    summaryId: string,
    targetId?: string
  ): Promise<{ ok: boolean }>;
  /** Cancel an in-flight idle summarization for the bound conversation. */
  abortIdle(): Promise<{ ok: boolean }>;
  abortLiveSummary(): Promise<{ ok: boolean }>;
  /** Persist a per-message override and refresh. */
  setMessageOverride(
    conversationId: string,
    messageId: string,
    override: ContextMessageOverride | null
  ): Promise<void>;
  /** Clear ALL overrides on the conversation. */
  resetMessageOverrides(conversationId: string): Promise<void>;
  /** Persist a partial rules patch and refresh. */
  updateRules(
    scope: 'global' | 'workspace',
    patch: Partial<ContextSummaryRules>,
    workspaceId?: string
  ): Promise<void>;
}

type Store = ContextSummaryState & ContextSummaryActions;

const initialState: ContextSummaryState = {
  boundId: null,
  mode: 'live',
  snapshot: null,
  rules: null,
  loading: false,
  error: null,
  unsubscribe: null,
  busy: false
};

export const useContextSummaryStore = create<Store>()((set, get) => ({
  ...initialState,

  open: async (id, mode) => {
    // Release a prior subscription before re-binding so the
    // matching `onSnapshotChanged` broadcast for an old run can't
    // re-trigger a fetch against the new id.
    const prev = get().unsubscribe;
    if (prev) {
      try { prev(); } catch (err) { log.debug('unsubscribe prev failed', { err }); }
    }
    // Subscribe AFTER the open path resolves so the first refetch
    // is deterministic; broadcasts that race the open simply
    // schedule the refresh against the live store.
    const unsubscribe = vyotiq.contextSummary.onSnapshotChanged(
      (runId: string) => {
        const cur = get();
        if (!cur.boundId) return;
        if (cur.boundId !== runId) return;
        void get().refresh();
      }
    );
    set({
      boundId: id,
      mode,
      snapshot: null,
      loading: true,
      error: null,
      unsubscribe
    });
    await get().refresh();
  },

  close: () => {
    const cur = get();
    if (cur.unsubscribe) {
      try { cur.unsubscribe(); } catch (err) { log.debug('unsubscribe failed', { err }); }
    }
    set({ ...initialState });
  },

  refresh: async () => {
    const cur = get();
    if (!cur.boundId) return;
    set({ loading: true, error: null });
    try {
      const snap = await vyotiq.contextSummary.inspect(cur.boundId);
      // Rules read in parallel — the snapshot already carries a
      // `rules` field, but it reflects the rules in effect for
      // the snapshot's workspace at the moment of the inspect()
      // call. The `getRules` IPC re-resolves at read time so a
      // settings change between the inspect and the panel render
      // is honored. Cheap (memoized settings cache).
      const rules = snap
        ? await vyotiq.contextSummary.getRules(snap.workspaceId || null)
        : null;
      set({
        snapshot: snap,
        rules,
        loading: false,
        error: snap
          ? null
          : "Couldn't read the orchestrator's context for this conversation."
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('refresh failed', { err: msg });
      set({ loading: false, error: msg });
    }
  },

  triggerManual: async () => {
    const cur = get();
    if (!cur.boundId) {
      return { ok: false, reason: 'No active conversation' };
    }
    set({ busy: true, error: null });
    let idleRunId: string | null = null;
    try {
      if (cur.mode === 'live') {
        // Live path — bound id is a runId. The IPC routes through
        // the orchestrator's `runContextRegistry` handle.
        const result = await vyotiq.contextSummary.triggerManual(cur.boundId);
        set({ busy: false, ...(result.ok ? {} : { error: result.reason }) });
        return result;
      }
      // Idle path — bound id is a conversationId. Mint a synthetic
      // runId, register the route in `useChatStore.runIdToConv`
      // BEFORE calling the IPC so the upcoming `CHAT_EVENT`
      // broadcasts route into the right slice. The matching
      // `chat:done` from main prunes the route entry on settle.
      idleRunId = `idle-summary-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
      useChatStore.getState().beginSideRun(idleRunId, cur.boundId);
      const result = await vyotiq.contextSummary.triggerManual(
        cur.boundId,
        idleRunId
      );
      if (!result.ok) {
        useChatStore.getState().finishRun(idleRunId);
      }
      set({ busy: false, ...(result.ok ? {} : { error: result.reason }) });
      return result;
    } catch (err) {
      if (idleRunId) {
        useChatStore.getState().finishRun(idleRunId);
      }
      const msg = err instanceof Error ? err.message : String(err);
      set({ busy: false, error: msg });
      return { ok: false, reason: msg };
    }
  },

  undo: async (summaryId, targetId) => {
    const cur = get();
    const chat = useChatStore.getState();
    const id =
      targetId ?? cur.boundId ?? chat.runId ?? chat.conversationId;
    if (!id) return { ok: false };
    set({ busy: true });
    try {
      const result = await vyotiq.contextSummary.undo(id, summaryId);
      if (result.ok && result.event && chat.conversationId) {
        useChatStore
          .getState()
          .applyConversationEvent(chat.conversationId, result.event);
      }
      if (result.ok && cur.boundId) void get().refresh();
      set({ busy: false });
      return { ok: result.ok };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ busy: false, error: msg });
      return { ok: false };
    }
  },

  abortIdle: async () => {
    const cur = get();
    const conversationId =
      cur.mode === 'idle'
        ? cur.boundId
        : useChatStore.getState().conversationId;
    if (!conversationId) return { ok: false };
    set({ busy: true });
    try {
      const result = await vyotiq.contextSummary.abortIdle(conversationId);
      set({ busy: false });
      if (result.ok && cur.boundId) void get().refresh();
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ busy: false, error: msg });
      return { ok: false };
    }
  },

  abortLiveSummary: async () => {
    const cur = get();
    if (cur.mode !== 'live' || !cur.boundId) return { ok: false };
    set({ busy: true });
    try {
      const result = await vyotiq.contextSummary.abortLive(cur.boundId);
      set({ busy: false });
      if (result.ok) void get().refresh();
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ busy: false, error: msg });
      return { ok: false };
    }
  },

  setMessageOverride: async (conversationId, messageId, override) => {
    try {
      await vyotiq.contextSummary.setMessageOverride(
        conversationId,
        messageId,
        override
      );
      // The runtime fans the persisted event back through the
      // chat IPC `onEvent` channel, so the live store updates on
      // its own. Snapshot refresh on broadcast handles the
      // Inspector's own row.
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('setMessageOverride failed', { err: msg });
      set({ error: msg });
    }
  },

  resetMessageOverrides: async (conversationId) => {
    try {
      await vyotiq.contextSummary.resetMessageOverrides(conversationId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('resetMessageOverrides failed', { err: msg });
      set({ error: msg });
    }
  },

  updateRules: async (scope, patch, workspaceId) => {
    try {
      await vyotiq.contextSummary.updateRules(scope, patch, workspaceId);
      // Re-pull the rules slot immediately — the snapshot-changed
      // broadcast covers active runs, but a Settings → Context
      // edit on an idle conversation won't fire one. Cheap: the
      // settings store's getter is memoized.
      const cur = get();
      if (cur.snapshot) {
        const rules = await vyotiq.contextSummary.getRules(
          cur.snapshot.workspaceId || null
        );
        set({ rules });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('updateRules failed', { err: msg });
      set({ error: msg });
    }
  }
}));
