/**
 * Chat / orchestrator state.
 *
 * Thin owner of the timeline state (see timeline/reducer/applyTimelineEvent).
 * Does not speak IPC directly — that lives in chatChannel.ts, which is
 * bootstrapped once from main.tsx and dispatches via the `applyEvent`
 * action below.
 *
 * Multi-session model:
 *   - `slices` is a registry of per-conversation state. Each slice
 *     carries its OWN `runId / isProcessing / runStartedAt / events / …`
 *     so a run that's still streaming in conversation A is not
 *     interrupted (or even visible) when the user flips to B.
 *   - `runIdToConv` is the dispatch table: `applyEvent(runId, event)`
 *     resolves the slice via this map BEFORE the activeConversationId
 *     guard, so late events from a prior run keep persisting through
 *     the orchestrator's chain and never get silently dropped just
 *     because the user has moved on.
 *   - The top-level `events / runId / isProcessing / …` fields are a
 *     mirror of the active slice. Every existing selector
 *     (`useChatStore((s) => s.events)`, etc.) keeps reading from the
 *     same shape — no callsite churn — but the underlying source of
 *     truth lives in `slices[activeConversationId]`.
 *
 * The mirror is updated by every action that touches the active
 * slice. Switching active conversations is a single `setActive` call
 * which copies the target slice into the mirror; abort / send / event
 * arrivals are routed by id and the mirror is refreshed only when
 * the change touches the currently-active slice.
 */

import { create } from 'zustand';
import type { TimelineEvent, ChatPermissions } from '@shared/types/chat.js';
import type { ActiveRunInfo } from '@shared/types/ipc.js';
import type { ModelSelection } from '@shared/types/provider.js';
import { vyotiq } from '../lib/ipc.js';
import { logger } from '../lib/logger.js';
import { randomId } from '../lib/ids.js';
import { useConversationsStore } from './useConversationsStore.js';
import { useSettingsStore } from './useSettingsStore.js';
import { useWorkspaceStore } from './useWorkspaceStore.js';
import { useToastStore } from './useToastStore.js';
import { useCheckpointsStore } from './useCheckpointsStore.js';
import {
  applyTimelineEvent,
  rebuildTimelineState,
  type ApplyEventOptions
} from '../components/timeline/reducer/applyTimelineEvent.js';
import {
  INITIAL_TIMELINE_STATE,
  type TimelineState,
  type TokenUsageAggregate,
  foldTokenUsage
} from '../components/timeline/reducer/types.js';

const log = logger.child('chat-store');

/**
 * Per-conversation slice. Mirrors what the old singleton store carried,
 * but keyed by `conversationId` so multiple slices can be live at once.
 *
 * Module-internal: every consumer reads through the active mirror's
 * surfaced fields (`s.events`, `s.runId`, etc.) rather than the slice
 * shape directly. Kept as a type for readability inside this file.
 */
interface ChatSlice extends TimelineState {
  conversationId: string;
  runId: string | null;
  isProcessing: boolean;
  runStartedAt: number | null;
  draft: string;
}

function emptySlice(conversationId: string): ChatSlice {
  return {
    ...INITIAL_TIMELINE_STATE,
    conversationId,
    runId: null,
    isProcessing: false,
    runStartedAt: null,
    draft: ''
  };
}

/**
 * Shape of the active-slice mirror surfaced at the top of the store.
 * Kept identical to the pre-multi-session shape so existing selector
 * hooks (`useChatStore((s) => s.events)`) need no rewrites.
 */
interface ActiveMirror extends TimelineState {
  conversationId: string | null;
  runId: string | null;
  isProcessing: boolean;
  runStartedAt: number | null;
  draft: string;
  /**
   * Aggregated usage across the orchestrator's own turns PLUS every
   * sub-agent in the active slice. Computed on mirror refresh so the
   * composer pill can show a "total run" token count.
   */
  totalRunUsage?: TokenUsageAggregate;
}

const EMPTY_MIRROR: ActiveMirror = {
  ...INITIAL_TIMELINE_STATE,
  // `INITIAL_TIMELINE_STATE` leaves `orchestratorUsage` off by omission;
  // explicit `undefined` here keeps the mirror's shape stable so a
  // partial Zustand merge never leaks the previous slice's aggregate
  // through.
  orchestratorUsage: undefined,
  totalRunUsage: undefined,
  conversationId: null,
  runId: null,
  isProcessing: false,
  runStartedAt: null,
  draft: ''
};

function mirrorOf(slice: ChatSlice): ActiveMirror {
  let totalRunUsage = slice.orchestratorUsage;
  for (const id in slice.subagents) {
    const sa = slice.subagents[id];
    if (sa?.usage) {
      totalRunUsage = foldTokenUsage(totalRunUsage, sa.usage.latest);
    }
  }
  return {
    events: slice.events,
    assistantTexts: slice.assistantTexts,
    reasoningTexts: slice.reasoningTexts,
    subagents: slice.subagents,
    // Mirror the orchestrator-scoped live partial-args map. Sub-agent
    // partials live on the matching snapshot inside `subagents` above.
    partialToolCallArgs: slice.partialToolCallArgs,
    // Audit fix H3 — settled-callId guard travels with the rest of
    // the reducer state so the renderer-side late-delta race check
    // works through the mirror selectors.
    settledCallIds: slice.settledCallIds,
    orchestratorUsage: slice.orchestratorUsage,
    // Propagate the orchestrator-scoped run-status slot. Without this,
    // `LiveStatusRow` would never see phase transitions because the
    // mirror is the surface every selector hook reads. Audit fix
    // §3.2.1 — the slot replaced an `events.push` walk and must travel
    // with the rest of the timeline state.
    latestOrchestratorRunStatus: slice.latestOrchestratorRunStatus,
    // Carries the latest `user-prompt` id so `Timeline`'s snap-on-send
    // effect depends on a primitive that flips ONLY at submit time
    // (audit fix §3.2.2). Without the propagation the mirror's
    // selector hook would never observe the value and the effect
    // would degrade back to scanning `events` on every delta.
    lastUserPromptId: slice.lastUserPromptId,
    // Content of the most-recent prompt; the regenerate affordance
    // reads this directly instead of walking the events list (audit
    // fix C2). Mirror-only — selectors that already key on
    // `lastUserPromptId` don't churn when this slot updates.
    lastUserPromptContent: slice.lastUserPromptContent,
    // Per-runId file-edit counts — drives the inline numeric badge on
    // `UserPromptRow`'s Revert button so users can see how many files
    // a turn touched without opening the rewind preview modal. Selectors
    // pluck a single bucket via `(s) => s.runIdToFileEditCount[runId]`
    // so re-renders are bounded by the affected prompt row, not the
    // whole timeline.
    runIdToFileEditCount: slice.runIdToFileEditCount,
    // Context-summarization streaming + lifecycle state. Mirrored
    // verbatim from the slice so per-row selectors
    // `(s) => s.summaries[summaryId]` re-render only the matching
    // `ContextSummaryRow`. The `messageOverrides` map flows through
    // the same path so the Inspector panel can read the live
    // toggle state without an IPC round-trip.
    summaries: slice.summaries,
    messageOverrides: slice.messageOverrides,
    totalRunUsage,
    conversationId: slice.conversationId,
    runId: slice.runId,
    isProcessing: slice.isProcessing,
    runStartedAt: slice.runStartedAt,
    draft: slice.draft
  };
}

interface ChatStore extends ActiveMirror {
  /** Per-conversation slices. The "registry" the plan describes. */
  slices: Record<string, ChatSlice>;
  /**
   * `runId → conversationId` dispatch table. Populated by `send()`
   * BEFORE awaiting the IPC so even instant streaming events have a
   * destination, and pruned by `finishRun` / `errorRun` after the
   * matching terminal event arrives. Late events for an unmapped
   * runId are dropped with a debug log (mirrors the old runId
   * guard).
   */
  runIdToConv: Record<string, string>;

  /**
   * Dispatch a single event through the reducer (used by chatChannel).
   * `opts.preParsedArgs` lets the bridge inject a pool-cached parse of
   * a `tool-call-args-delta` event so the reducer skips its own
   * one-shot `safeParsePartial`. Phase 1.1.
   */
  applyEvent: (runId: string, event: TimelineEvent, opts?: ApplyEventOptions) => void;
  /** Mark a run finished (from the IPC `done` channel). */
  finishRun: (runId: string) => void;
  /** Record a run-level error (from the IPC `error` channel). */
  errorRun: (runId: string, message: string) => void;
  /**
   * Materialise / replace the slice for a conversation. Used by
   * `useConversationsStore.select` after a transcript read, and by
   * `newConversation` to seed an empty slice.
   */
  setTranscript: (conversationId: string | null, events: TimelineEvent[]) => void;
  /**
   * Switch the active mirror to a different conversation slice WITHOUT
   * touching its in-flight state. Auto-creates an empty slice when
   * none exists yet. `null` clears the mirror entirely (used by
   * `clear()` and post-remove flows).
   */
  setActiveConversation: (conversationId: string | null) => void;
  /**
   * Drop a conversation's slice and prune any dangling runId
   * mappings. Called when a conversation is removed so memory
   * doesn't accumulate ghost slices forever. The mirror is also
   * cleared when the dropped slice was active.
   */
  dropConversation: (conversationId: string) => void;
  /** Kick off a send through IPC. Guards against concurrent taps. */
  send: (
    prompt: string,
    selection: ModelSelection,
    permissions: ChatPermissions,
    options?: { attachments?: string[] }
  ) => Promise<void>;
  /** Abort the in-flight run on the ACTIVE slice (if any). */
  abort: () => Promise<void>;
  /**
   * Abort a specific run by id. Used by the sidebar's per-row abort
   * affordance so a sibling conversation's run can be stopped without
   * first switching to it. The matching slice's `isProcessing` is
   * flipped immediately for snappy feedback; the authoritative
   * `done` / `error` event still arrives via the IPC channel and
   * cleans up `runId` / mapping as usual.
   */
  abortRun: (runId: string) => Promise<void>;
  /**
   * Rehydrate `runIdToConv` + per-slice `runId / isProcessing /
   * runStartedAt` from main's snapshot of in-flight runs. Called once
   * at boot from `bootstrapChatChannel` so a renderer reload (HMR /
   * F5) can re-attach to live runs in main rather than dropping their
   * subsequent events as "ghosts". Idempotent: entries whose runId is
   * already mapped are left untouched.
   */
  rehydrateActiveRuns: (infos: ActiveRunInfo[]) => void;
  /**
   * Pre-warm a slice with persisted transcript events WITHOUT touching
   * the active mirror or in-flight `runId / isProcessing` fields.
   * Used by the boot-time sibling-transcript pre-warm so the FIRST
   * switch into any persisted-active workspace's last conversation is
   * instant. Re-pre-warming an already-hydrated slice is a no-op.
   */
  prewarmSlice: (conversationId: string, events: TimelineEvent[]) => void;
  /**
   * Write the composer's unsent draft for a specific conversation.
   * Persisted across conversation switches so a user can leave a
   * half-typed message in one chat, switch elsewhere, and return to
   * find it intact. The Composer's hydration effect re-syncs `text`
   * from this slot whenever the active conversation flips.
   */
  setDraft: (conversationId: string, text: string) => void;
  /** Reset only the active slice. Used by "New conversation" flows. */
  clear: () => void;
}

/**
 * In-place slice mutation helper. Returns a new `slices` map with
 * `id` → updater(prev). Auto-seeds an empty slice when missing so
 * late events for a slice that hasn't been materialised yet still
 * find a target — this matches the old auto-recovery behaviour in
 * `appendEvent` on the main side.
 */
function updateSlice(
  slices: Record<string, ChatSlice>,
  id: string,
  updater: (prev: ChatSlice) => ChatSlice
): Record<string, ChatSlice> {
  const prev = slices[id] ?? emptySlice(id);
  return { ...slices, [id]: updater(prev) };
}

export const useChatStore = create<ChatStore>((set, get) => ({
  ...EMPTY_MIRROR,
  slices: {},
  runIdToConv: {},

  applyEvent: (runId, event, opts) => {
    const convId = get().runIdToConv[runId];
    if (!convId) {
      // Late delivery for a run whose mapping was already pruned — or
      // an event from before this renderer's hydration. Either way
      // there's no destination, so drop it. This is the multi-session
      // analogue of the old `s.runId !== runId` guard.
      log.debug('applyEvent dropped: runId not mapped to a conversation', { runId, kind: event.kind });
      return;
    }
    set((s) => {
      const nextSlices = updateSlice(s.slices, convId, (prev) => ({
        ...prev,
        ...applyTimelineEvent(prev, event, opts)
      }));
      // Mirror only when the affected slice is the active one — keeps
      // selector subscriptions cheap for inactive slices, which would
      // otherwise re-render the whole timeline on every background
      // event.
      if (s.conversationId === convId) {
        return { ...s, slices: nextSlices, ...mirrorOf(nextSlices[convId]!) };
      }
      return { ...s, slices: nextSlices };
    });
  },

  finishRun: (runId) => {
    const convId = get().runIdToConv[runId];
    if (!convId) {
      // F-011: pre-fix this branch fired a `useConversationsStore.refresh()`
      // call. The unmapped path is reached only for late `done` events
      // whose dispatch entry was already pruned (or for events from a
      // run we never knew about). In either case there's no new
      // conversation metadata for this runId to surface, so the IPC
      // round-trip was pure waste. The mapped path below still calls
      // refresh() — that covers the legitimate "title may have just
      // been derived" case.
      log.debug('finishRun dropped: runId not mapped', { runId });
      return;
    }
    set((s) => {
      const nextSlices = updateSlice(s.slices, convId, (prev) =>
        prev.runId === runId
          ? {
            ...prev,
            isProcessing: false,
            runId: null,
            runStartedAt: null,
            // Audit fix C3: clear the orchestrator-scoped run-status
            // slot on terminal transitions so the next run's first
            // event can't briefly display the previous run's last
            // phase. `LiveStatusRow` is gated on `isProcessing` so
            // nothing visibly changes today, but the slot is part of
            // the public selector surface and dangling stale
            // telemetry is a real footgun for any future consumer.
            latestOrchestratorRunStatus: undefined
          }
          : prev
      );
      // Prune the mapping so subsequent late events don't keep
      // resurrecting the dispatch path — and `runIdToConv` doesn't
      // grow unboundedly across long sessions.
      const nextMap: Record<string, string> = { ...s.runIdToConv };
      delete nextMap[runId];
      const patch = { slices: nextSlices, runIdToConv: nextMap };
      if (s.conversationId === convId) {
        return { ...s, ...patch, ...mirrorOf(nextSlices[convId]!) };
      }
      return { ...s, ...patch };
    });
    void useConversationsStore.getState().refresh();
  },

  errorRun: (runId, message) => {
    const convId = get().runIdToConv[runId];
    if (!convId) {
      log.debug('errorRun dropped: runId not mapped', { runId, message });
      return;
    }
    // F-024 (audit fix): `chat:error` is the run-level termination
    // signal, not a fresh timeline event. The matching error event has
    // ALREADY arrived via `chat:event` (`AgentV.ts` catch path emits it
    // before calling `deps.onError`, which fires this IPC). Re-injecting
    // here produced two visually-identical error rows. We now only
    // clear the run-state slots and trust the event stream to have
    // delivered the error row.
    //
    // `message` is still passed to this action so a future
    // observability surface (e.g. a "last error" badge on the sidebar
    // row) can read it without parsing the timeline. For now we just
    // log it so a renderer reload that lost a chat:event but still
    // received chat:error can be triaged from the renderer console.
    log.debug('errorRun: clearing run state (timeline event came via chat:event)', {
      runId,
      messagePreview: message.slice(0, 200)
    });
    set((s) => {
      const nextSlices = updateSlice(s.slices, convId, (prev) => {
        if (prev.runId !== runId) return prev;
        return {
          ...prev,
          isProcessing: false,
          runId: null,
          runStartedAt: null,
          // Audit fix C3 — see `finishRun`.
          latestOrchestratorRunStatus: undefined
        };
      });
      const nextMap: Record<string, string> = { ...s.runIdToConv };
      delete nextMap[runId];
      const patch = { slices: nextSlices, runIdToConv: nextMap };
      if (s.conversationId === convId) {
        return { ...s, ...patch, ...mirrorOf(nextSlices[convId]!) };
      }
      return { ...s, ...patch };
    });
  },

  setTranscript: (conversationId, events) => {
    if (conversationId === null) {
      // Explicit "no active conversation" — used during a workspace
      // remove cascade. Clears the mirror but leaves `slices` alone so
      // any still-streaming runs in OTHER workspaces continue to flow.
      set((s) => ({ ...s, ...EMPTY_MIRROR, slices: s.slices, runIdToConv: s.runIdToConv }));
      return;
    }
    const rebuilt = rebuildTimelineState(events);
    set((s) => {
      // Preserve any in-flight `runId / isProcessing / runStartedAt`
      // already on the slice — this is the entire point of the
      // registry: switching a transcript view in must NOT clobber an
      // active run. Only the persisted reducer state is replaced.
      const prior = s.slices[conversationId];
      const nextSlice: ChatSlice = {
        ...emptySlice(conversationId),
        events: rebuilt.events,
        assistantTexts: rebuilt.assistantTexts,
        reasoningTexts: rebuilt.reasoningTexts,
        subagents: rebuilt.subagents,
        ...(rebuilt.orchestratorUsage !== undefined
          ? { orchestratorUsage: rebuilt.orchestratorUsage }
          : {}),
        // Carry every reducer-maintained primitive that downstream
        // selectors read directly. Pre-fix this branch dropped
        // `lastUserPromptId` / `lastUserPromptContent`, which broke
        // the snap-on-send effect on conversation switches and the
        // regenerate affordance until a fresh `user-prompt` event
        // landed. The `runIdToFileEditCount` slot is in the same
        // bucket — without it the per-prompt Revert badge would lose
        // its count after a reload of a conversation that already
        // has FS edits in its transcript.
        ...(rebuilt.lastUserPromptId !== undefined
          ? { lastUserPromptId: rebuilt.lastUserPromptId }
          : {}),
        ...(rebuilt.lastUserPromptContent !== undefined
          ? { lastUserPromptContent: rebuilt.lastUserPromptContent }
          : {}),
        runIdToFileEditCount: rebuilt.runIdToFileEditCount,
        // Carry the rebuilt summarization + override state so a
        // transcript reload restores the persisted Inspector view
        // and the active `ContextSummaryRow`s without an extra IPC
        // round-trip. The reducer's branches already paired
        // `(pending, end, undone)` events into the same final
        // shape the live path produces.
        summaries: rebuilt.summaries,
        messageOverrides: rebuilt.messageOverrides,
        // Keep live run fields intact when the slice already exists —
        // critical for the "switch away mid-run, switch back" flow.
        runId: prior?.runId ?? null,
        isProcessing: prior?.isProcessing ?? false,
        runStartedAt: prior?.runStartedAt ?? null,
        draft: prior?.draft ?? ''
      };
      const nextSlices = { ...s.slices, [conversationId]: nextSlice };
      return { ...s, slices: nextSlices, ...mirrorOf(nextSlice) };
    });
  },

  setActiveConversation: (conversationId) => {
    if (conversationId === null) {
      set((s) => ({ ...s, ...EMPTY_MIRROR, slices: s.slices, runIdToConv: s.runIdToConv }));
      return;
    }
    set((s) => {
      const slice = s.slices[conversationId] ?? emptySlice(conversationId);
      const nextSlices = s.slices[conversationId] ? s.slices : { ...s.slices, [conversationId]: slice };
      return { ...s, slices: nextSlices, ...mirrorOf(slice) };
    });
  },

  dropConversation: (conversationId) => {
    set((s) => {
      if (!s.slices[conversationId]) return s;
      const nextSlices = { ...s.slices };
      delete nextSlices[conversationId];
      // Prune any runId mappings that pointed at this conversation —
      // their events would land on an empty slice otherwise.
      const nextMap: Record<string, string> = {};
      for (const [rid, cid] of Object.entries(s.runIdToConv)) {
        if (cid !== conversationId) nextMap[rid] = cid;
      }
      const wasActive = s.conversationId === conversationId;
      return wasActive
        ? { ...s, ...EMPTY_MIRROR, slices: nextSlices, runIdToConv: nextMap }
        : { ...s, slices: nextSlices, runIdToConv: nextMap };
    });
  },

  send: async (prompt, selection, permissions, options) => {
    // Only the active slice's `isProcessing` gates new sends.
    if (get().isProcessing) return;
    const runId = randomId();
    // Resolve the active workspace id so the IPC call lands the run
    // (and any auto-created conversation) in the right workspace.
    // The store is a pure ref read here — no IPC.
    const workspaceId = useWorkspaceStore.getState().activeId ?? undefined;
    const startedAt = Date.now();

    // Pre-create before IPC so the first synchronous `user-prompt` event
    // already has a conversation mapping and workspace binding.
    let conversationId = get().conversationId ?? undefined;
    if (!conversationId) {
      if (!workspaceId) {
        // Surface the failure on the mirror so the user sees why their
        // input vanished. Composer.handleSend clears the textarea BEFORE
        // awaiting send, so a silent `return` here would erase the
        // prompt with zero feedback. The error event lands on the
        // mirror (no slice exists yet for an unbound send) — the user
        // can pick a workspace and retype.
        log.warn('send called without an active workspace; aborting');
        set((s) => {
          const next = applyTimelineEvent(s, {
            kind: 'error',
            id: randomId(),
            ts: Date.now(),
            message: 'Pick a workspace before sending a message.'
          });
          return { ...s, ...next };
        });
        return;
      }
      const meta = await useConversationsStore.getState().newConversation();
      if (!meta) {
        // `newConversation()` already logged the underlying failure;
        // surface it to the user via the mirror's error row so a
        // silent no-op can't hide a misconfigured IPC surface.
        set((s) => {
          const next = applyTimelineEvent(s, {
            kind: 'error',
            id: randomId(),
            ts: Date.now(),
            message: 'Could not create a new conversation. Check the app logs.'
          });
          return { ...s, ...next };
        });
        return;
      }
      conversationId = meta.id;
    }
    // At this point `conversationId` is guaranteed non-undefined —
    // either the caller had an active slot or we just pre-created
    // one. The rest of `send()` is the uniform fixed-conversation
    // path; the mapping / slice flip is synchronous in one `set()`.
    const boundId = conversationId;

    set((s) => {
      const nextMap = { ...s.runIdToConv, [runId]: boundId };
      const nextSlices = updateSlice(s.slices, boundId, (prev) => ({
        ...prev,
        runId,
        isProcessing: true,
        runStartedAt: startedAt
      }));
      return { ...s, slices: nextSlices, runIdToConv: nextMap, ...mirrorOf(nextSlices[boundId]!) };
    });

    try {
      const reply = await vyotiq.chat.send({
        runId,
        prompt,
        selection,
        permissions,
        conversationId: boundId,
        ...(workspaceId ? { workspaceId } : {}),
        ...(options?.attachments && options.attachments.length > 0
          ? { attachments: options.attachments }
          : {})
      });
      if (!reply) {
        throw new Error('chat:send rejected by main process (no reply).');
      }
      // Structured refusal: the run's workspace has
      // `gatePromptOnPendingByWorkspace` set AND the conversation has
      // unresolved pending checkpoint entries. Main DID NOT start a
      // run — we just unwind the optimistic slice flag, refresh the
      // pending list so the panel appears, and surface a toast.
      if (reply.ok === false) {
        if (reply.kind === 'pending-checkpoints') {
          useToastStore
            .getState()
            .show(
              `Resolve ${reply.count} pending change${reply.count === 1 ? '' : 's'} before sending — Accept or Reject each row in the panel below.`,
              'danger'
            );
          void useCheckpointsStore.getState().refreshPending(reply.conversationId);
          // Roll back the optimistic isProcessing flag we set right
          // before the IPC call so the composer's Stop button
          // disappears and the user can edit / re-send.
          set((s) => {
            const nextMap: Record<string, string> = { ...s.runIdToConv };
            delete nextMap[runId];
            const nextSlices = updateSlice(s.slices, boundId, (prev) => ({
              ...prev,
              runId: null,
              isProcessing: false,
              runStartedAt: null
            }));
            return s.conversationId === boundId
              ? { ...s, slices: nextSlices, runIdToConv: nextMap, ...mirrorOf(nextSlices[boundId]!) }
              : { ...s, slices: nextSlices, runIdToConv: nextMap };
          });
          return;
        }
        throw new Error('chat:send rejected by main process (unknown reply shape).');
      }
      if (!reply.conversationId) {
        throw new Error('chat:send rejected by main process (no conversationId in reply).');
      }
      // Main should echo our boundId. If it doesn't (legacy auto-create
      // fallback somehow firing), we still align the slot with main's
      // authoritative id — but log a warning so the regression surfaces
      // loudly rather than silently forking the transcript.
      if (reply.conversationId !== boundId) {
        log.warn('chat:send reply conversationId differs from pre-created id', {
          sent: boundId,
          received: reply.conversationId
        });
      }
      // Pass `workspaceId` explicitly so `bindActive` never has to
      // derive it from a stale `list` lookup — removing the second
      // half of the original race. The `list` will catch up on the
      // next refresh triggered inside `bindActive`.
      useConversationsStore.getState().bindActive(reply.conversationId, workspaceId);
      // Stamp the workspace's last-used model. Identity-skipped inside
      // the setter when the value is unchanged so repeated sends with
      // the same selection don't churn settings.json. Fire-and-forget
      // — a settings write failure must NEVER fail the user's send.
      if (workspaceId) {
        useSettingsStore
          .getState()
          .setLastModelByWorkspace(workspaceId, selection)
          .catch((err) => log.warn('setLastModelByWorkspace failed', { workspaceId, err }));
      }
    } catch (err) {
      const errEvent = {
        kind: 'error' as const,
        id: randomId(),
        ts: Date.now(),
        message: err instanceof Error ? err.message : String(err)
      };
      set((s) => {
        // The error lands on whichever slice is currently bound — the
        // pre-existing one for a fixed-conversation send, or the
        // mirror itself for an auto-create that never resolved.
        const targetId = s.runIdToConv[runId];
        const nextMap: Record<string, string> = { ...s.runIdToConv };
        delete nextMap[runId];
        if (targetId) {
          const nextSlices = updateSlice(s.slices, targetId, (prev) => {
            const next = applyTimelineEvent(prev, errEvent);
            return { ...prev, ...next, runId: null, isProcessing: false, runStartedAt: null };
          });
          const patch = { slices: nextSlices, runIdToConv: nextMap };
          return s.conversationId === targetId
            ? { ...s, ...patch, ...mirrorOf(nextSlices[targetId]!) }
            : { ...s, ...patch };
        }
        // Auto-create that never bound — surface the error on the
        // mirror so the user sees it, but there's no slice to update.
        const next = applyTimelineEvent(s, errEvent);
        return { ...s, ...next, runIdToConv: nextMap, runId: null, isProcessing: false, runStartedAt: null };
      });
    }
  },

  abort: async () => {
    // Aborts only the ACTIVE slice's run. Use the per-slice runId
    // (the mirror's value reflects the same field). Inactive runs
    // keep going — that's the whole point of the multi-session
    // architecture.
    const id = get().runId;
    if (!id) return;
    const convId = get().conversationId;
    set((s) => {
      // Flip the spinner immediately on the slice + mirror; keep
      // `runId` set until the matching `done` / `error` arrives, so
      // late aborted-text events still route to the right slice.
      if (!convId) {
        return s.runId === id ? { ...s, isProcessing: false } : s;
      }
      const nextSlices = updateSlice(s.slices, convId, (prev) =>
        prev.runId === id ? { ...prev, isProcessing: false } : prev
      );
      return { ...s, slices: nextSlices, ...mirrorOf(nextSlices[convId]!) };
    });
    await vyotiq.chat.abort(id);
  },

  abortRun: async (runId: string) => {
    if (!runId) return;
    // Resolve the slice the runId is bound to so we can flip its
    // `isProcessing` immediately. Sibling-slice aborts must update
    // their slice (so the per-row indicator clears) AND, when the
    // sibling happens to be the active slice, the mirror.
    const convId = get().runIdToConv[runId];
    set((s) => {
      if (!convId) return s;
      const nextSlices = updateSlice(s.slices, convId, (prev) =>
        prev.runId === runId ? { ...prev, isProcessing: false } : prev
      );
      if (s.conversationId === convId) {
        return { ...s, slices: nextSlices, ...mirrorOf(nextSlices[convId]!) };
      }
      return { ...s, slices: nextSlices };
    });
    await vyotiq.chat.abort(runId);
  },

  rehydrateActiveRuns: (infos) => {
    if (!Array.isArray(infos)) return;
    set((s) => {
      // Audit fix M-17: build the new map from the SNAPSHOT, not by
      // additively layering onto `s.runIdToConv`. Pre-fix, the
      // rehydrate path only ADDED entries — if main had forgotten
      // about a runId (renderer reload after a dropped `chat:done` /
      // `chat:error` event, forced quit mid-run, abort path that
      // never settled), the stale runId in the renderer's local map
      // survived forever. Over long sessions with frequent reloads
      // this accumulated unbounded.
      //
      // The replacement contract: anything NOT in the authoritative
      // snapshot is pruned. Anything in the snapshot is preserved
      // (with the renderer's `boundId` if it was already mapped, or
      // the snapshot's `conversationId` for fresh entries). Net
      // effect: the renderer's `runIdToConv` always agrees with
      // main's view of in-flight runs after every rehydrate.
      const snapshotMap = new Map<string, string>();
      for (const info of infos) {
        if (info.conversationId) snapshotMap.set(info.runId, info.conversationId);
      }

      // Compute the pruned + extended map.
      const prevMap = s.runIdToConv;
      const nextMap: Record<string, string> = {};
      let pruned = 0;
      for (const [rid, cid] of Object.entries(prevMap)) {
        if (snapshotMap.has(rid)) {
          // Keep the existing binding (renderer-bound conversationId
          // is authoritative — it survived the auto-create rebind).
          nextMap[rid] = cid;
        } else {
          pruned += 1;
        }
      }
      for (const [rid, cid] of snapshotMap) {
        if (!(rid in nextMap)) nextMap[rid] = cid;
      }
      if (pruned > 0) {
        log.debug('rehydrateActiveRuns pruned stale runIds', { pruned });
      }

      // Apply per-slice `runId / isProcessing / runStartedAt` for any
      // newly-rehydrated infos. Pre-existing slices whose `runId`
      // matches a snapshot entry are left untouched (their isProcessing
      // is already true).
      let nextSlices = s.slices;
      let touched = Object.keys(nextMap).length !== Object.keys(prevMap).length;
      for (const info of infos) {
        if (!info.conversationId) continue;
        const slice = nextSlices[info.conversationId];
        if (slice && slice.runId === info.runId) continue;
        nextSlices = updateSlice(nextSlices, info.conversationId, (prev) => ({
          ...prev,
          runId: info.runId,
          isProcessing: true,
          runStartedAt: info.startedAt ?? prev.runStartedAt ?? Date.now()
        }));
        touched = true;
      }
      if (!touched) return s;
      const activeId = s.conversationId;
      if (activeId && nextSlices[activeId]) {
        return { ...s, slices: nextSlices, runIdToConv: nextMap, ...mirrorOf(nextSlices[activeId]!) };
      }
      return { ...s, slices: nextSlices, runIdToConv: nextMap };
    });
  },

  setDraft: (conversationId, text) => {
    set((s) => {
      const nextSlices = updateSlice(s.slices, conversationId, (prev) => ({
        ...prev,
        draft: text
      }));
      if (s.conversationId === conversationId) {
        return { ...s, slices: nextSlices, draft: text };
      }
      return { ...s, slices: nextSlices };
    });
  },

  prewarmSlice: (conversationId, events) => {
    if (!conversationId) return;
    set((s) => {
      // Idempotent. If a slice is already populated (in-flight run, or
      // a prior `setTranscript` already hydrated it) leave it alone —
      // overwriting could clobber tail events that arrived between the
      // disk read and this call.
      const existing = s.slices[conversationId];
      if (existing && existing.events.length > 0) return s;
      const rebuilt = rebuildTimelineState(events);
      const fresh: ChatSlice = {
        ...emptySlice(conversationId),
        events: rebuilt.events,
        assistantTexts: rebuilt.assistantTexts,
        reasoningTexts: rebuilt.reasoningTexts,
        subagents: rebuilt.subagents,
        ...(rebuilt.orchestratorUsage !== undefined
          ? { orchestratorUsage: rebuilt.orchestratorUsage }
          : {}),
        summaries: rebuilt.summaries,
        messageOverrides: rebuilt.messageOverrides,
        // Preserve any in-flight fields that may have been set by a
        // racing `rehydrateActiveRuns` for this same conversation.
        runId: existing?.runId ?? null,
        isProcessing: existing?.isProcessing ?? false,
        runStartedAt: existing?.runStartedAt ?? null,
        draft: existing?.draft ?? ''
      };
      const nextSlices = { ...s.slices, [conversationId]: fresh };
      // Pre-warm must NOT flip the active mirror; only refresh when
      // the conversation we just warmed happens to already be the
      // active one (rare — pre-warm targets sibling slots).
      if (s.conversationId === conversationId) {
        return { ...s, slices: nextSlices, ...mirrorOf(fresh) };
      }
      return { ...s, slices: nextSlices };
    });
  },

  clear: () => {
    // Reset only the ACTIVE slice. Sibling slices (in-flight runs in
    // other conversations) are intentionally untouched.
    const convId = get().conversationId;
    if (!convId) {
      set((s) => ({ ...s, ...EMPTY_MIRROR, slices: s.slices, runIdToConv: s.runIdToConv }));
      return;
    }
    set((s) => {
      const fresh = emptySlice(convId);
      const nextSlices = { ...s.slices, [convId]: fresh };
      // Prune any runIds pointing at this conversation — clearing the
      // slice while a runId mapping survives would resurrect a half-
      // started run on the next event.
      const nextMap: Record<string, string> = {};
      for (const [rid, cid] of Object.entries(s.runIdToConv)) {
        if (cid !== convId) nextMap[rid] = cid;
      }
      return { ...s, slices: nextSlices, runIdToConv: nextMap, ...mirrorOf(fresh) };
    });
  }
}));
