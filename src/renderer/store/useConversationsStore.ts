/**
 * Conversations slice. Mirrors the persistent JSONL transcripts on the main
 * side. Owns the conversation list, the per-workspace active-conversation
 * map, and the load/select/rename/remove flows.
 *
 * Multi-workspace model:
 *   - `list` is the FULL cross-workspace history. The left navigation dock
 *     filters by `meta.workspaceId`; the orchestrator's
 *     `<prior_conversations>` envelope filters via the main-side
 *     `listConversations(workspaceId)` overload so this list never
 *     leaks across workspaces inside a run.
 *   - `activeIdByWorkspace` records the last conversation each
 *     workspace was viewing. Switching workspaces restores the
 *     previous slot for that group instead of forcing the user to
 *     re-pick a session every time.
 *   - `activeId()` derives the current selection from the active
 *     workspace's slot. Components reading the legacy `activeId`
 *     field get the same semantics through the convenience
 *     selector — no callsite churn.
 *
 * The chat timeline itself lives in `useChatStore`; this slice drives WHICH
 * conversation the active mirror reflects. `select()` no longer aborts
 * the in-flight run on switch — the chat store's slice registry keeps
 * the previous run streaming in the background.
 */

import { create } from 'zustand';
import type { ConversationMeta, TimelineEvent } from '@shared/types/chat.js';
import { vyotiq } from '../lib/ipc.js';
import { logger } from '../lib/logger.js';
import { useChatStore } from './useChatStore.js';
import { useTimelineUiStore } from './useTimelineUiStore.js';
import { useWorkspaceStore } from './useWorkspaceStore.js';
import { useSettingsStore } from './useSettingsStore.js';
// Static-import the toast store. Previously lazy-imported inside
// `move()` to "keep it off the hot path", but the toast store is
// already in the eager bundle (ToastHost / dock / FileEditRow all
// statically import it), so the dynamic-only edge created a vite
// chunking warning without yielding a real bundle savings.
import { useToastStore } from './useToastStore.js';

const log = logger.child('conversations');

/**
 * Placeholder title written by main on conversation creation. `bindActive`
 * uses this to decide whether a refresh is worth the IPC: a chat still
 * carrying the placeholder is a candidate for an auto-derived title from
 * the first prompt, so a refresh is needed; one with a real title isn't.
 * Mirrors the constant in `src/main/conversations/conversationStore.ts`.
 */
const PLACEHOLDER_TITLE = 'New conversation';

/** Merge a backfilled peak from `conversations.read` into the list mirror. */
function patchListPeak(
  list: ConversationMeta[],
  id: string,
  peak?: number
): ConversationMeta[] {
  if (typeof peak !== 'number' || peak <= 0) return list;
  return list.map((m) =>
    m.id === id && (m.peakPromptTokens ?? 0) < peak ? { ...m, peakPromptTokens: peak } : m
  );
}

interface ConversationsStore {
  list: ConversationMeta[];
  loading: boolean;
  /**
   * Per-workspace active-conversation slot. Hydrated from
   * `AppSettings.ui.activeConversationByWorkspace` on app boot.
   * Persisted on every change.
   */
  activeIdByWorkspace: Record<string, string | null>;
  /**
   * Tracks which conversation transcripts have already been hydrated
   * into a chat slice this session. Lets `select()` skip the
   * round-trip read when flipping back to a recently-viewed
   * conversation — the chat store still has the slice from last
   * time. Cleared per-id on `remove()`.
   */
  hydratedIds: Set<string>;

  refresh: () => Promise<void>;
  /**
   * Create a new conversation in the active workspace and switch to it.
   * Returns the freshly created meta so callers (notably `useChatStore.send`)
   * can register mappings + seed slices synchronously before firing the
   * next IPC, eliminating the event-order race that otherwise drops the
   * first `user-prompt` event on the auto-create path.
   */
  newConversation: () => Promise<ConversationMeta | null>;
  /**
   * Variant of `newConversation` targeted at a specific workspace.
   * Activates the workspace first if it isn't already active, then
   * creates the conversation under it. Used by the per-workspace
   * "+ new chat" button on the dock so users can start a
   * fresh chat under any group with a single click instead of
   * "activate group → click toolbar New".
   */
  newConversationFor: (workspaceId: string) => Promise<ConversationMeta | null>;
  /**
   * Load a conversation's transcript (if not yet hydrated) and switch
   * the chat store's active mirror to it. Does NOT abort any in-flight
   * run — the previous slice keeps streaming in the background.
   */
  select: (id: string) => Promise<void>;
  rename: (id: string, title: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  archive: (id: string) => Promise<void>;
  unarchive: (id: string) => Promise<void>;
  /** True while `select()` is loading an unhydrated transcript. */
  selecting: boolean;
  /**
   * Drag-between-workspaces. Moves a conversation under a different
   * workspace's group. Aborts any in-flight runs pinned to it
   * server-side (re-pinning workspaceId mid-run would silently swap
   * the orchestrator's sandbox), then updates `meta.workspaceId` and
   * fixes up `activeIdByWorkspace` so the source workspace's slot
   * doesn't keep pointing at a conversation that no longer belongs
   * to it.
   *
   * No-op when `targetWorkspaceId === source workspace`. Failures
   * surface as a toast and roll the optimistic update back.
   */
  move: (id: string, targetWorkspaceId: string) => Promise<void>;
  reconcileWithMain: () => Promise<void>;
  /**
   * Hydrate a conversation's transcript into the chat store WITHOUT
   * flipping the active mirror. Used by the boot-time sibling pre-warm
   * (see `App.tsx`) so the FIRST switch into any persisted last-active
   * sibling session is instant — `select()` then short-circuits via
   * `hydratedIds`. Idempotent: re-warming an already-hydrated id is a
   * cheap no-op.
   */
  prewarm: (id: string) => Promise<void>;
  /**
   * Drop a conversation from the hydrated set after its chat slice was
   * unloaded from memory. The next `select(id)` re-reads JSONL from disk.
   */
  markSliceUnloaded: (id: string) => void;
  /**
   * Called by chat when a run binds (or auto-creates) the active
   * conversation id. Updates the workspace's slot and refreshes the
   * list so the auto-derived title shows up in the dock.
   */
  bindActive: (id: string, workspaceId?: string) => void;
  /**
   * Hydrate the per-workspace active-id map from persisted settings.
   * Called once on app boot from `App.tsx` after `settings.load()`.
   */
  hydrateActiveByWorkspace: (map: Record<string, string>) => void;
}

/**
 * Convenience selector — returns the active id for the currently-active
 * workspace, or `null` if either is unset. Mirrors the pre-multi
 * `activeId` semantics for legacy components.
 */
export function useActiveConversationId(): string | null {
  const activeWs = useWorkspaceStore((s) => s.activeId);
  const slot = useConversationsStore((s) =>
    activeWs ? s.activeIdByWorkspace[activeWs] ?? null : null
  );
  return slot;
}

/**
 * Persist the workspace → active-conversation map back into
 * `AppSettings.ui.activeConversationByWorkspace`. Drops `null` slots
 * so the persisted blob doesn't accumulate empty entries forever.
 */
function persistActiveMap(map: Record<string, string | null>): void {
  const cleaned: Record<string, string> = {};
  for (const [wsId, convId] of Object.entries(map)) {
    if (typeof convId === 'string' && convId.length > 0) cleaned[wsId] = convId;
  }
  void useSettingsStore.getState().setActiveConversationByWorkspace(cleaned);
}

/**
 * Monotonic counter incremented on every `select(id)` entry. After
 * the JSONL `await`, the function compares the captured epoch
 * against the current value; a mismatch means the user has clicked
 * a newer conversation while this read was in flight, so the result
 * is discarded instead of overwriting the active mirror's transcript
 * with stale data.
 *
 * The active-mirror flip is global (the chat store has a single
 * `conversationId` mirror), so a single counter — not a per-id map
 * — correctly defends every cross-conversation race. Audit fix
 * §3.3.2.
 */
let selectEpoch = 0;

/**
 * Tracks in-flight `conversations.read` calls started by `select()`.
 * `selecting` mirrors `selectReadInFlight > 0`. A refcount (not a
 * boolean cleared only when `myEpoch === selectEpoch`) is required
 * because a superseding `select()` can short-circuit via `hydratedIds`
 * — e.g. DockChatStrip `prewarm()` finishing while the boot-time
 * `App.tsx` effect's first read is still awaiting — leaving the
 * stale read's `finally` unable to clear the spinner.
 */
let selectReadInFlight = 0;

function syncSelecting(set: (partial: Partial<ConversationsStore>) => void): void {
  set({ selecting: selectReadInFlight > 0 });
}

/** Test-only reset for module-level select spinner state. */
export function __resetSelectSpinnerForTests(): void {
  selectEpoch = 0;
  selectReadInFlight = 0;
}

export const useConversationsStore = create<ConversationsStore>((set, get) => ({
  list: [],
  loading: false,
  selecting: false,
  activeIdByWorkspace: {},
  hydratedIds: new Set<string>(),

  refresh: async () => {
    set({ loading: true });
    try {
      // Always fetch the FULL list — the dock groups by
      // `meta.workspaceId` itself. The orchestrator's per-run
      // filtering happens main-side via `listConversations(wsId)`.
      const list = await vyotiq.conversations.list();
      set({ list, loading: false });
    } catch (err) {
      set({ loading: false });
      log.error('conversations.list failed', { err });
    }
  },

  newConversation: async () => {
    const activeWs = useWorkspaceStore.getState().activeId;
    if (!activeWs) {
      // No workspace registered yet. Surface a clear hint via the
      // chat store's error path so the user gets a "pick a workspace
      // first" message in the timeline. The composer's send button
      // is gated on `isProcessing`, not on this — so we don't get a
      // silent no-op.
      log.warn('newConversation called without an active workspace');
      return null;
    }
    try {
      const meta = await vyotiq.conversations.create(activeWs);
      set((s) => {
        const nextActiveMap = { ...s.activeIdByWorkspace, [activeWs]: meta.id };
        persistActiveMap(nextActiveMap);
        const nextHydrated = new Set(s.hydratedIds);
        nextHydrated.add(meta.id);
        return {
          list: [meta, ...s.list],
          activeIdByWorkspace: nextActiveMap,
          hydratedIds: nextHydrated
        };
      });
      // Seed an empty slice and switch the chat mirror to it.
      useChatStore.getState().setTranscript(meta.id, []);
      return meta;
    } catch (err) {
      log.error('conversations.create failed', { err, workspaceId: activeWs });
      return null;
    }
  },

  newConversationFor: async (workspaceId) => {
    // If the target workspace isn't already active, activate it first.
    // The await is intentional: a fresh chat must land under the user's
    // visible focus and `useWorkspaceStore.setActive` self-persists +
    // refreshes its `info` mirror, which downstream effects (e.g. the
    // composer's model resolver) read.
    const wsStore = useWorkspaceStore.getState();
    if (wsStore.activeId !== workspaceId) {
      await wsStore.setActive(workspaceId);
    }
    try {
      const meta = await vyotiq.conversations.create(workspaceId);
      set((s) => {
        const nextActiveMap = { ...s.activeIdByWorkspace, [workspaceId]: meta.id };
        persistActiveMap(nextActiveMap);
        const nextHydrated = new Set(s.hydratedIds);
        nextHydrated.add(meta.id);
        return {
          list: [meta, ...s.list],
          activeIdByWorkspace: nextActiveMap,
          hydratedIds: nextHydrated
        };
      });
      useChatStore.getState().setTranscript(meta.id, []);
      return meta;
    } catch (err) {
      log.error('conversations.create failed', { err, workspaceId });
      return null;
    }
  },

  select: async (id) => {
    // Bump the global select epoch on EVERY entry — including the
    // synchronous short-circuit branches below — so an in-flight
    // read started by a prior `select(otherId)` can detect that
    // it's been superseded even when the user's next click hits a
    // hydrated id and never starts its own read.
    //
    // `myEpoch` is captured BEFORE any await (`wsStore.setActive`,
    // `vyotiq.conversations.read`) so a click landing during ANY of
    // those awaits supersedes us. Audit fix §3.3.2.
    const myEpoch = ++selectEpoch;

    const wsStore = useWorkspaceStore.getState();
    const meta = get().list.find((m) => m.id === id);

    // Multi-workspace correctness: a row click in a sibling group must
    // attribute the slot to the picked conversation's OWN workspace
    // (not the currently-active one) — otherwise we stamp
    // `activeIdByWorkspace[activeA] = idFromB`, which corrupts A's
    // slot until `reconcileWithMain` nulls it on the next pass.
    //
    // Falls back to the active workspace only when meta is missing
    // (e.g. a list-refresh / click race), with a warn — the legacy
    // single-workspace path stays unchanged.
    const ownerWs = meta?.workspaceId;
    const activeWs = wsStore.activeId;
    const targetWs = ownerWs ?? activeWs;
    if (!targetWs) {
      log.warn('select called without an active workspace', { id });
      return;
    }
    if (!meta && get().list.length > 0) {
      log.info('select: conversation not in catalogue; clearing stale slot', { id });
      set((s) => {
        let changed = false;
        const nextActiveMap = { ...s.activeIdByWorkspace };
        for (const [wsId, convId] of Object.entries(nextActiveMap)) {
          if (convId === id) {
            nextActiveMap[wsId] = null;
            changed = true;
          }
        }
        if (!changed) return s;
        persistActiveMap(nextActiveMap);
        return { ...s, activeIdByWorkspace: nextActiveMap };
      });
      return;
    }
    if (!meta) {
      log.warn(
        'select: conversation meta not in list — using active workspace as slot owner',
        { id, activeWs }
      );
    }

    // Write the destination slot SYNCHRONOUSLY before any setActive
    // flip. The App-level workspace-change effect (`App.tsx`) re-runs
    // `select` on the new active workspace's slot — by writing first,
    // the effect reads the already-correct id and short-circuits via
    // the hydrate guards below instead of briefly flipping the chat
    // mirror to the destination workspace's PRIOR slot value.
    set((s) => {
      if (s.activeIdByWorkspace[targetWs] === id) return s;
      const nextActiveMap = { ...s.activeIdByWorkspace, [targetWs]: id };
      persistActiveMap(nextActiveMap);
      return { ...s, activeIdByWorkspace: nextActiveMap };
    });

    // Cross-workspace switch: activate the destination workspace.
    // Awaited so the workspace-store flip + its persistence are
    // visible before we hydrate / flip the chat mirror.
    if (ownerWs && activeWs !== ownerWs) {
      await wsStore.setActive(ownerWs);
    }

    // No abort — the multi-session architecture explicitly keeps
    // sibling slices streaming. The previous in-flight run continues
    // to persist into its own JSONL via main and keeps its slice in
    // the chat store; switching back later is a single mirror flip.

    // If the chat mirror already points at this id AND the slice is
    // hydrated, nothing further to do. Cheap reference compare avoids
    // redundant slice reads.
    if (useChatStore.getState().conversationId === id && get().hydratedIds.has(id)) {
      return;
    }

    // Hydrate path. If already hydrated, this is a synchronous mirror
    // flip — no IPC.
    if (get().hydratedIds.has(id)) {
      useChatStore.getState().setActiveConversation(id);
      return;
    }

    // If a newer `select(...)` landed during the workspace-activate
    // await above, drop ours entirely — flipping the mirror to OUR id
    // now would visibly clobber the user's latest pick before the
    // newer click's read resolves. Audit fix §3.3.2.
    if (myEpoch !== selectEpoch) {
      log.info('select: superseded during workspace activate; aborting', { id });
      return;
    }

    // Optimistic flip: switch the mirror to the (currently empty)
    // slice IMMEDIATELY so the user sees a fresh ChatPage instead of
    // the previous workspace's stale timeline while the JSONL read
    // resolves. The disk-read may take 100s of ms on slow mounts; the
    // `setActiveConversation` call seeds an empty slice if missing,
    // which Timeline renders as the empty / fresh state. The
    // subsequent `setTranscript` upgrades the slice in place.
    useChatStore.getState().setActiveConversation(id);
    selectReadInFlight++;
    syncSelecting(set);

    let events: TimelineEvent[] = [];
    let peakPromptTokens: number | undefined;
    try {
      const conv = await vyotiq.conversations.read(id);
      if (conv) {
        events = conv.events;
        peakPromptTokens = conv.peakPromptTokens;
      }
    } catch (err) {
      log.error('conversations.read failed', { err });
    } finally {
      selectReadInFlight = Math.max(0, selectReadInFlight - 1);
      syncSelecting(set);
    }
    if (myEpoch !== selectEpoch) {
      // A newer `select(...)` raced ahead while we awaited. Drop the
      // result silently — `hydratedIds` is INTENTIONALLY left untouched
      // so the next click on this id re-issues the read instead of
      // short-circuiting against a half-loaded slice.
      log.info('select: superseded by newer click; dropping stale read', { id });
      return;
    }
    set((s) => {
      const nextHydrated = new Set(s.hydratedIds);
      nextHydrated.add(id);
      return {
        hydratedIds: nextHydrated,
        list: patchListPeak(s.list, id, peakPromptTokens)
      };
    });
    useChatStore.getState().setTranscript(id, events);
  },

  prewarm: async (id) => {
    if (get().hydratedIds.has(id)) return;
    let events: TimelineEvent[] = [];
    let peakPromptTokens: number | undefined;
    try {
      const conv = await vyotiq.conversations.read(id);
      if (conv) {
        events = conv.events;
        peakPromptTokens = conv.peakPromptTokens;
      }
    } catch (err) {
      log.warn('prewarm: conversations.read failed', { err, id });
      return;
    }
    // Re-check after the await — `select(id)` may have hydrated this
    // slice in parallel, in which case we'd otherwise overwrite a
    // potentially-newer version with the on-disk snapshot.
    if (get().hydratedIds.has(id)) return;
    set((s) => {
      const nextHydrated = new Set(s.hydratedIds);
      nextHydrated.add(id);
      return {
        hydratedIds: nextHydrated,
        list: patchListPeak(s.list, id, peakPromptTokens)
      };
    });
    useChatStore.getState().prewarmSlice(id, events);
  },

  markSliceUnloaded: (id) => {
    set((s) => {
      if (!s.hydratedIds.has(id)) return s;
      const nextHydrated = new Set(s.hydratedIds);
      nextHydrated.delete(id);
      return { hydratedIds: nextHydrated };
    });
  },

  rename: async (id, title) => {
    try {
      const updated = await vyotiq.conversations.rename(id, title);
      set((s) => ({
        list: s.list.map((m) => (m.id === id ? updated : m))
      }));
    } catch (err) {
      log.error('conversations.rename failed', { err, id });
    }
  },

  archive: async (id) => {
    try {
      const updated = await vyotiq.conversations.archive(id);
      set((s) => ({
        list: s.list.map((m) => (m.id === id ? updated : m))
      }));
    } catch (err) {
      log.error('conversations.archive failed', { err, id });
      useToastStore.getState().show('Could not archive chat.', 'danger');
    }
  },

  unarchive: async (id) => {
    try {
      const updated = await vyotiq.conversations.unarchive(id);
      set((s) => ({
        list: s.list.map((m) => (m.id === id ? updated : m))
      }));
    } catch (err) {
      log.error('conversations.unarchive failed', { err, id });
      useToastStore.getState().show('Could not restore chat.', 'danger');
    }
  },

  remove: async (id) => {
    try {
      await vyotiq.conversations.remove(id);
    } catch (err) {
      log.error('conversations.remove failed', { err, id });
      return;
    }
    set((s) => {
      // Clear the id from every workspace slot it might be the
      // active selection of (a conversation only belongs to one
      // workspace, so this is at most one match — the loop is just
      // defensive against any future cross-workspace move feature).
      const nextActiveMap: Record<string, string | null> = { ...s.activeIdByWorkspace };
      for (const [wsId, convId] of Object.entries(s.activeIdByWorkspace)) {
        if (convId === id) nextActiveMap[wsId] = null;
      }
      persistActiveMap(nextActiveMap);
      const nextHydrated = new Set(s.hydratedIds);
      nextHydrated.delete(id);
      return {
        list: s.list.filter((m) => m.id !== id),
        activeIdByWorkspace: nextActiveMap,
        hydratedIds: nextHydrated
      };
    });
    // Drop persisted expand/collapse state for the removed conversation so
    // `AppSettings.ui.expandedRows` doesn't accumulate stale ids forever.
    useTimelineUiStore.getState().clearConversation(id);
    // Drop the slice + any dangling runId mappings.
    useChatStore.getState().dropConversation(id);
  },

  move: async (id, targetWorkspaceId) => {
    const meta = get().list.find((m) => m.id === id);
    if (!meta) {
      log.warn('move: conversation meta not in list', { id });
      return;
    }
    const sourceWorkspaceId = meta.workspaceId;
    if (sourceWorkspaceId === targetWorkspaceId) return;

    // Optimistic flip: re-stamp the meta + fix up the active-conversation
    // slot for both the source and target workspaces. The source slot
    // is cleared so the user doesn't return to a sibling group's chat
    // accidentally; the target slot is left alone (a drag drop is
    // explicitly NOT a "select" — the user may want the chat to live
    // under that group without forcing it active).
    const prev = {
      list: [...get().list],
      activeIdByWorkspace: { ...get().activeIdByWorkspace }
    };
    set((s) => {
      const nextList = s.list.map((m) =>
        m.id === id ? { ...m, workspaceId: targetWorkspaceId, updatedAt: Date.now() } : m
      );
      const nextActiveMap: Record<string, string | null> = { ...s.activeIdByWorkspace };
      if (sourceWorkspaceId && nextActiveMap[sourceWorkspaceId] === id) {
        nextActiveMap[sourceWorkspaceId] = null;
      }
      persistActiveMap(nextActiveMap);
      return { list: nextList, activeIdByWorkspace: nextActiveMap };
    });

    // Drop the chat slice for this conversation if it was the active
    // mirror's source workspace's slot — without it the chat mirror
    // would keep showing this transcript even though the dock's
    // group highlight has flipped away. The slice itself stays alive
    // in the registry by id so a follow-up `select(id)` is instant.
    if (useChatStore.getState().conversationId === id && sourceWorkspaceId) {
      const activeWs = useWorkspaceStore.getState().activeId;
      if (activeWs === sourceWorkspaceId) {
        useChatStore.getState().setActiveConversation(null);
      }
    }

    try {
      const updated = await vyotiq.conversations.move(id, targetWorkspaceId);
      // Reconcile: replace the optimistic meta with main's authoritative
      // copy (workspaceId + updatedAt). No tree-cache invalidation
      // beyond the normal conversation list rerender — the picker cache
      // keys on workspace path, not conversation id.
      set((s) => ({
        list: s.list.map((m) => (m.id === id ? updated : m))
      }));
    } catch (err) {
      log.error('conversations.move failed; rolling back optimistic update', { err, id, targetWorkspaceId });
      set(() => ({
        list: prev.list,
        activeIdByWorkspace: prev.activeIdByWorkspace
      }));
      persistActiveMap(prev.activeIdByWorkspace);
      const msg = err instanceof Error ? err.message : String(err);
      useToastStore.getState().show(`Could not move conversation: ${msg}`, 'danger');
    }
  },

  reconcileWithMain: async () => {
    let nextList: ConversationMeta[];
    try {
      nextList = await vyotiq.conversations.list();
    } catch (err) {
      log.error('conversations.list failed during reconcile', { err });
      return;
    }
    set((s) => {
      const nextIds = new Set(nextList.map((m) => m.id));
      const nextById = new Map(nextList.map((m) => [m.id, m]));
      const removedIds = s.list.map((m) => m.id).filter((id) => !nextIds.has(id));
      const workspaceIds = new Set(useWorkspaceStore.getState().list.map((w) => w.id));
      const nextActiveMap: Record<string, string | null> = {};
      const removedWorkspaceSlots: string[] = [];
      for (const [wsId, convId] of Object.entries(s.activeIdByWorkspace)) {
        if (!workspaceIds.has(wsId)) {
          if (convId) removedWorkspaceSlots.push(convId);
          continue;
        }
        if (!convId) {
          nextActiveMap[wsId] = null;
          continue;
        }
        const meta = nextById.get(convId);
        nextActiveMap[wsId] = meta && meta.workspaceId === wsId ? convId : null;
      }
      for (const convId of removedWorkspaceSlots) {
        const meta = nextById.get(convId);
        const workspaceId = meta?.workspaceId;
        if (!workspaceId || !workspaceIds.has(workspaceId)) continue;
        if (nextActiveMap[workspaceId]) continue;
        nextActiveMap[workspaceId] = convId;
      }
      persistActiveMap(nextActiveMap);
      const nextHydrated = new Set<string>();
      for (const id of s.hydratedIds) {
        if (nextIds.has(id)) nextHydrated.add(id);
      }
      for (const id of removedIds) {
        useTimelineUiStore.getState().clearConversation(id);
        useChatStore.getState().dropConversation(id);
      }
      return {
        list: nextList,
        activeIdByWorkspace: nextActiveMap,
        hydratedIds: nextHydrated
      };
    });
  },

  bindActive: (id, workspaceId) => {
    // Bind under the conversation's OWN workspace, not necessarily the
    // currently-active one — a run that started in workspace A while
    // the user was viewing A keeps its binding under A even if the
    // user has since flipped to B.
    // Prefer the explicit workspace id supplied by chat send; fall back
    // to loaded meta when callers only know the conversation id.
    const meta = get().list.find((m) => m.id === id);
    const wsId = workspaceId ?? meta?.workspaceId;
    set((s) => {
      const nextHydrated = new Set(s.hydratedIds);
      // Just bound a freshly-created conversation: chat store seeded
      // it with `setTranscript(id, [])`, so it's hydrated.
      nextHydrated.add(id);
      if (!wsId) return { hydratedIds: nextHydrated };
      // Skip the persist / rebind churn when the slot is already set.
      if (s.activeIdByWorkspace[wsId] === id) return { hydratedIds: nextHydrated };
      const nextActiveMap = { ...s.activeIdByWorkspace, [wsId]: id };
      persistActiveMap(nextActiveMap);
      return { activeIdByWorkspace: nextActiveMap, hydratedIds: nextHydrated };
    });
    // Only refresh when there's something to learn from main:
    //   (a) the bound id isn't in the list yet (auto-create path), or
    //   (b) the persisted title is still the placeholder — main may
    //       have derived a title from the first prompt and we need to
    //       fetch it for the dock.
    // Re-sending in an already-titled chat becomes a zero-IPC update,
    // which matters for long lists + multi-session where a chatty user
    // would otherwise refire the full `conversations.list` IPC on every
    // send.
    const needsRefresh = !meta || meta.title === PLACEHOLDER_TITLE;
    if (needsRefresh) void get().refresh();
  },

  hydrateActiveByWorkspace: (map) => {
    set({ activeIdByWorkspace: { ...map } });
  }
}));
