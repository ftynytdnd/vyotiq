/**
 * Timeline UI store — holds per-conversation expand/collapse state for
 * Cascade-style rows (tool groups, reasoning lines, file-edit groups,
 * and nested expansions).
 * Persisted under `AppSettings.ui.expandedRows` via the existing
 * `settings:get` / `settings:set` IPC. Hydrated exactly once from
 * `App.tsx` after settings resolve; subsequent toggles fire-and-forget
 * a debounced patch so the disk never blocks the UI.
 *
 * Keys are opaque strings scoped per row (e.g. `tool-group:<callId>`),
 * grouped inside a record keyed by `conversationId`. Unknown conversation
 * ids default to collapsed.
 */

import { create } from 'zustand';
import { vyotiq } from '../lib/ipc.js';

const DEBOUNCE_MS = 400;

interface TimelineUiStore {
  /** conversationId → set of expanded row keys. */
  expandedByConvo: Record<string, Set<string>>;
  /**
   * Per-conversation set of row keys the user has explicitly toggled
   * AT LEAST ONCE during this conversation. Lets consumers distinguish
   * "user-driven" from "host-driven" expansion. Tool-group rows read
   * this so that auto-expand-while-running only kicks in for rows the
   * user has not interacted with yet — once the user collapses or
   * expands a row manually, that choice persists across status flips.
   *
   * NOT persisted to disk; it's a per-session signal. Cleared on
   * conversation switch by `clearConversation`.
   */
  manualOverrideByConvo: Record<string, Set<string>>;
  hydrated: boolean;

  hydrate: (persisted: Record<string, string[]> | undefined) => void;
  toggle: (conversationId: string, rowKey: string) => void;
  /**
   * Force the persisted expand state to a specific value AND record a
   * manual override. Used by rows whose effective expand state is
   * derived from external signals (e.g. live tool status) — those
   * cannot rely on the persisted value matching the user's current
   * visual state, so a plain `toggle` would invert the wrong baseline.
   */
  setExpanded: (conversationId: string, rowKey: string, value: boolean) => void;
  isExpanded: (conversationId: string | null, rowKey: string) => boolean;
  /** True iff the user has manually toggled this row this session. */
  hasManualOverride: (conversationId: string | null, rowKey: string) => boolean;
  /** Clear every row key for a given conversation. */
  clearConversation: (conversationId: string) => void;

  /**
   * Session-only diff context-fold expansion keyed by
   * `${diffInstanceId}:hunk:${hunkIdx}`. Not persisted — survives
   * intra-hunk re-renders and partial→authoritative variant flips
   * within the same viewer instance.
   */
  diffFoldExpandedByScope: Record<string, ReadonlySet<string>>;
  toggleDiffFold: (scopeKey: string, foldId: string) => void;

  /** True when the main timeline scroll is pinned to the latest messages. */
  timelineAtTail: boolean;
  setTimelineAtTail: (atTail: boolean) => void;
  /** Monotonic counter — increment to request scroll-to-tail from outside Timeline. */
  scrollToTailRequest: number;
  requestScrollToTail: () => void;
}

// F-010 / F-015 note: `persistTimer` and `pendingExpanded` are
// module-globals rather than store state. This is intentional for two
// reasons: (1) the debounce window is implementation detail that no
// consumer should subscribe to, so it should not live in the
// reactive store; (2) keeping them at module scope guarantees a
// single global timer per renderer process even if the store is
// re-created (which it isn't today, but Zustand `create` would
// otherwise allow).
//
// Trade-off accepted: under HMR the module is re-evaluated and these
// reset to `null`, losing any in-flight debounce. The `beforeunload`
// flush in `main.tsx` handles the production teardown path; HMR only
// fires in dev where a lost toggle is paid for by the next click.
// Same trade-off applies to `useUiStore`'s layout/collapsed
// persisters (introduced under F-016).
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let pendingExpanded: Record<string, Set<string>> | null = null;

function buildPayload(expanded: Record<string, Set<string>>): Record<string, string[]> {
  const payload: Record<string, string[]> = {};
  for (const [cid, keys] of Object.entries(expanded)) {
    if (keys.size === 0) continue;
    payload[cid] = Array.from(keys);
  }
  return payload;
}

function persistLater(expanded: Record<string, Set<string>>): void {
  pendingExpanded = expanded;
  if (persistTimer !== null) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const snapshot = pendingExpanded ?? expanded;
    pendingExpanded = null;
    void vyotiq.settings.set({ ui: { expandedRows: buildPayload(snapshot) } }).catch(() => {
      /* swallow: non-critical, fire-and-forget */
    });
  }, DEBOUNCE_MS);
}

/**
 * Flush any debounced `expandedRows` write immediately. Called from
 * `beforeunload` so a pending toggle isn't lost when the renderer tears
 * down. Best-effort: the IPC call itself is fire-and-forget because the
 * page is unloading.
 */
export function flushTimelineUiPersistence(): void {
  if (persistTimer === null || pendingExpanded === null) return;
  clearTimeout(persistTimer);
  const snapshot = pendingExpanded;
  persistTimer = null;
  pendingExpanded = null;
  void vyotiq.settings.set({ ui: { expandedRows: buildPayload(snapshot) } }).catch(() => {
    /* noop */
  });
}

export const useTimelineUiStore = create<TimelineUiStore>((set, get) => ({
  expandedByConvo: {},
  manualOverrideByConvo: {},
  diffFoldExpandedByScope: {},
  hydrated: false,
  timelineAtTail: true,
  setTimelineAtTail: (atTail) => set({ timelineAtTail: atTail }),
  scrollToTailRequest: 0,
  requestScrollToTail: () =>
    set((s) => ({ scrollToTailRequest: s.scrollToTailRequest + 1 })),

  hydrate: (persisted) => {
    const next: Record<string, Set<string>> = {};
    if (persisted) {
      for (const [cid, keys] of Object.entries(persisted)) {
        next[cid] = new Set(keys);
      }
    }
    set({ expandedByConvo: next, hydrated: true });
  },

  toggle: (conversationId, rowKey) => {
    const cur = get().expandedByConvo[conversationId] ?? new Set<string>();
    const nextSet = new Set(cur);
    if (nextSet.has(rowKey)) nextSet.delete(rowKey);
    else nextSet.add(rowKey);
    const nextMap = { ...get().expandedByConvo, [conversationId]: nextSet };

    // Mark this row as user-driven for the current conversation. The
    // override is additive; once a row earns it, it survives status
    // flips so auto-expand-while-running only governs rows the user has
    // never touched.
    const overridesCur = get().manualOverrideByConvo[conversationId] ?? new Set<string>();
    const overridesNext = new Set(overridesCur);
    overridesNext.add(rowKey);
    const overridesMap = {
      ...get().manualOverrideByConvo,
      [conversationId]: overridesNext
    };

    set({ expandedByConvo: nextMap, manualOverrideByConvo: overridesMap });
    if (get().hydrated) persistLater(nextMap);
  },

  setExpanded: (conversationId, rowKey, value) => {
    const cur = get().expandedByConvo[conversationId] ?? new Set<string>();
    const nextSet = new Set(cur);
    if (value) nextSet.add(rowKey);
    else nextSet.delete(rowKey);
    const nextMap = { ...get().expandedByConvo, [conversationId]: nextSet };

    const overridesCur = get().manualOverrideByConvo[conversationId] ?? new Set<string>();
    const overridesNext = new Set(overridesCur);
    overridesNext.add(rowKey);
    const overridesMap = {
      ...get().manualOverrideByConvo,
      [conversationId]: overridesNext
    };

    set({ expandedByConvo: nextMap, manualOverrideByConvo: overridesMap });
    if (get().hydrated) persistLater(nextMap);
  },

  isExpanded: (conversationId, rowKey) => {
    if (!conversationId) return false;
    const set = get().expandedByConvo[conversationId];
    return set ? set.has(rowKey) : false;
  },

  hasManualOverride: (conversationId, rowKey) => {
    if (!conversationId) return false;
    const set = get().manualOverrideByConvo[conversationId];
    return set ? set.has(rowKey) : false;
  },

  clearConversation: (conversationId) => {
    const expanded = get().expandedByConvo;
    const overrides = get().manualOverrideByConvo;
    if (!(conversationId in expanded) && !(conversationId in overrides)) return;
    // Build cleaned copies without the `void _drop…` workaround. Both
    // maps are small (O(conversations seen this session)) so the
    // O(n) filter is cheaper than the cost of any per-entry copy
    // tradeoff.
    const restExpanded: Record<string, Set<string>> = {};
    for (const [k, v] of Object.entries(expanded)) {
      if (k !== conversationId) restExpanded[k] = v;
    }
    const restOverrides: Record<string, Set<string>> = {};
    for (const [k, v] of Object.entries(overrides)) {
      if (k !== conversationId) restOverrides[k] = v;
    }
    set({ expandedByConvo: restExpanded, manualOverrideByConvo: restOverrides });
    if (get().hydrated) persistLater(restExpanded);
  },

  toggleDiffFold: (scopeKey, foldId) => {
    const cur = get().diffFoldExpandedByScope[scopeKey] ?? new Set<string>();
    const next = new Set(cur);
    if (next.has(foldId)) next.delete(foldId);
    else next.add(foldId);
    set({
      diffFoldExpandedByScope: {
        ...get().diffFoldExpandedByScope,
        [scopeKey]: next
      }
    });
  }
}));
