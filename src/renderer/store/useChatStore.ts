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
import { normalizeLegacyTranscript } from '@shared/transcript/normalizeLegacyTranscript.js';
import type { TimelineEvent } from '@shared/types/chat.js';
import { vyotiq } from '../lib/ipc.js';
import { logger } from '../lib/logger.js';
import { randomId } from '../lib/ids.js';
import { useConversationsStore } from './useConversationsStore.js';
import { useSettingsStore } from './useSettingsStore.js';
import { useWorkspaceStore } from './useWorkspaceStore.js';
import { useToastStore } from './useToastStore.js';
import { useCheckpointsStore } from './useCheckpointsStore.js';
import { useAskUserDraftStore } from './askUserDraft.js';
import { findPendingAskUserEvent } from '../lib/pendingAskUser.js';
import { buildAskUserSubmitInput } from '../lib/buildAskUserSubmitInput.js';
import { clearStreamingToolPreview } from '../components/timeline/reducer/clearStreamingToolPreview.js';
import {
  applyTimelineEvent,
  rebuildTimelineState
} from '../components/timeline/reducer/applyTimelineEvent.js';
import { EMPTY_FOLLOW_UP_STATE, FollowUpQueueFullError } from '@shared/types/followUp.js';
import { MAX_FOLLOW_UP_QUEUE_DEPTH } from '@shared/constants.js';
import {
  type ChatSlice,
  type ChatStore,
  EMPTY_MIRROR,
  emptySlice
} from './chatStoreTypes.js';
import { mirrorOf } from './chatStoreMirror.js';
import { shouldUnloadIdleSlice, unloadIdleSlice } from './chatStoreRam.js';
import {
  clearSpendPromptBaseline,
  mergeSpendPromptBaseline,
  syncSpendPromptBaseline
} from '../lib/spendPromptBaseline.js';

export { __resetTotalRunUsageCacheForTests } from './chatStoreTotalRunUsage.js';

const log = logger.child('chat-store');

function prepareTranscriptEventsForLoad(events: TimelineEvent[]): TimelineEvent[] {
  return normalizeLegacyTranscript(events);
}

async function dispatchAbortForRun(runId: string): Promise<void> {
  await vyotiq.chat.abort(runId);
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

function maybeUnloadIdleSlice(prevId: string | null, getSlices: () => Record<string, ChatSlice>, setSlices: (next: Record<string, ChatSlice>) => void): void {
  if (!prevId) return;
  const slice = getSlices()[prevId];
  if (!shouldUnloadIdleSlice(slice)) return;
  setSlices({ ...getSlices(), [prevId]: unloadIdleSlice(slice) });
  useConversationsStore.getState().markSliceUnloaded(prevId);
}

export const useChatStore = create<ChatStore>((set, get) => ({
  ...EMPTY_MIRROR,
  slices: {},
  runIdToConv: {},
  runIdToModel: {},

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

  applyConversationEvent: (conversationId, event, opts) => {
    set((s) => {
      const nextSlices = updateSlice(s.slices, conversationId, (prev) => ({
        ...prev,
        ...applyTimelineEvent(prev, event, opts ?? {})
      }));
      if (s.conversationId === conversationId) {
        return { ...s, slices: nextSlices, ...mirrorOf(nextSlices[conversationId]!) };
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
      const nextSlices = updateSlice(s.slices, convId, (prev) => {
        const cleared =
          prev.runId === runId
            ? clearStreamingToolPreview({
                ...prev,
                isProcessing: false,
                awaitingAskUser: false,
                runId: null,
                runStartedAt: null,
                latestOrchestratorRunStatus: undefined
              })
            : prev;
        return cleared;
      });
      // Prune the mapping so subsequent late events don't keep
      // resurrecting the dispatch path — and `runIdToConv` doesn't
      // grow unboundedly across long sessions. The parallel
      // `runIdToModel` map is pruned in lockstep.
      const nextMap: Record<string, string> = { ...s.runIdToConv };
      delete nextMap[runId];
      const nextModelMap: Record<string, string> = { ...s.runIdToModel };
      delete nextModelMap[runId];
      const patch = {
        slices: nextSlices,
        runIdToConv: nextMap,
        runIdToModel: nextModelMap
      };
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
    // observability surface (e.g. a "last error" badge on the dock
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
        return clearStreamingToolPreview({
          ...prev,
          isProcessing: false,
          awaitingAskUser: false,
          runId: null,
          runStartedAt: null,
          // Audit fix C3 — see `finishRun`.
          latestOrchestratorRunStatus: undefined
        });
      });
      const nextMap: Record<string, string> = { ...s.runIdToConv };
      delete nextMap[runId];
      const nextModelMap: Record<string, string> = { ...s.runIdToModel };
      delete nextModelMap[runId];
      const patch = {
        slices: nextSlices,
        runIdToConv: nextMap,
        runIdToModel: nextModelMap
      };
      if (s.conversationId === convId) {
        return { ...s, ...patch, ...mirrorOf(nextSlices[convId]!) };
      }
      return { ...s, ...patch };
    });
  },

  setTranscript: (conversationId, events, paging = null) => {
    if (conversationId === null) {
      // Explicit "no active conversation" — used during a workspace
      // remove cascade. Clears the mirror but leaves `slices` alone so
      // any still-streaming runs in OTHER workspaces continue to flow.
      set((s) => ({ ...s, ...EMPTY_MIRROR, slices: s.slices, runIdToConv: s.runIdToConv }));
      return;
    }
    set((s) => {
      const prepared = prepareTranscriptEventsForLoad(events);
      syncSpendPromptBaseline(conversationId, prepared);
      const rebuilt = rebuildTimelineState(prepared);
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
        ...(rebuilt.orchestratorUsage !== undefined
          ? { orchestratorUsage: rebuilt.orchestratorUsage }
          : {}),
        ...(rebuilt.latestContextUsage !== undefined
          ? { latestContextUsage: rebuilt.latestContextUsage }
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
        // Keep live run fields intact when the slice already exists —
        // critical for the "switch away mid-run, switch back" flow.
        runId: prior?.runId ?? null,
        isProcessing: prior?.isProcessing ?? false,
        awaitingAskUser: prior?.awaitingAskUser ?? false,
        runStartedAt: prior?.runStartedAt ?? null,
        draft: prior?.draft ?? '',
        attachmentDraft: prior?.attachmentDraft ?? [],
        followUps: prior?.followUps ?? { steering: [], queued: [] },
        transcriptPaging: paging
      };
      const nextSlices = { ...s.slices, [conversationId]: nextSlice };
      // Only flip the active mirror when this transcript IS the one
      // the user is viewing. Background reads (checkpoint rewind,
      // prewarm for a sibling tab) must not clobber the visible timeline.
      if (s.conversationId === conversationId) {
        return { ...s, slices: nextSlices, ...mirrorOf(nextSlice) };
      }
      return { ...s, slices: nextSlices };
    });
  },

  prependTranscript: (conversationId, olderEvents, paging) => {
    if (olderEvents.length === 0) return;
    mergeSpendPromptBaseline(conversationId, prepareTranscriptEventsForLoad(olderEvents));
    set((s) => {
      const prior = s.slices[conversationId];
      if (!prior) return s;
      const merged = [...olderEvents, ...prior.events];
      const prepared = prepareTranscriptEventsForLoad(merged);
      const rebuilt = rebuildTimelineState(prepared);
      const nextSlice: ChatSlice = {
        ...prior,
        events: rebuilt.events,
        assistantTexts: rebuilt.assistantTexts,
        reasoningTexts: rebuilt.reasoningTexts,
        ...(rebuilt.orchestratorUsage !== undefined
          ? { orchestratorUsage: rebuilt.orchestratorUsage }
          : {}),
        ...(rebuilt.latestContextUsage !== undefined
          ? { latestContextUsage: rebuilt.latestContextUsage }
          : {}),
        ...(rebuilt.lastUserPromptId !== undefined
          ? { lastUserPromptId: rebuilt.lastUserPromptId }
          : {}),
        ...(rebuilt.lastUserPromptContent !== undefined
          ? { lastUserPromptContent: rebuilt.lastUserPromptContent }
          : {}),
        runIdToFileEditCount: rebuilt.runIdToFileEditCount,
        transcriptPaging: paging
      };
      const nextSlices = { ...s.slices, [conversationId]: nextSlice };
      if (s.conversationId === conversationId) {
        return { ...s, slices: nextSlices, ...mirrorOf(nextSlice) };
      }
      return { ...s, slices: nextSlices };
    });
  },

  setActiveConversation: (conversationId) => {
    const prevId = get().conversationId;
    if (conversationId === null) {
      set((s) => ({ ...s, ...EMPTY_MIRROR, slices: s.slices, runIdToConv: s.runIdToConv }));
      maybeUnloadIdleSlice(
        prevId,
        () => get().slices,
        (nextSlices) => set((s) => ({ ...s, slices: nextSlices }))
      );
      return;
    }
    set((s) => {
      const slice = s.slices[conversationId] ?? emptySlice(conversationId);
      const nextSlices = s.slices[conversationId] ? s.slices : { ...s.slices, [conversationId]: slice };
      return { ...s, slices: nextSlices, ...mirrorOf(slice) };
    });
    if (prevId && prevId !== conversationId) {
      maybeUnloadIdleSlice(
        prevId,
        () => get().slices,
        (nextSlices) => set((s) => ({ ...s, slices: nextSlices }))
      );
    }
    void get().loadFollowUps(conversationId);
  },

  dropConversation: (conversationId) => {
    clearSpendPromptBaseline(conversationId);
    useCheckpointsStore.getState().dropConversation(conversationId);
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

  send: async (prompt, selection, options) => {
    // Only the active slice's `isProcessing` gates new sends.
    if (get().isProcessing || get().awaitingAskUser) return;
    const runId = randomId();
    const activeWorkspaceId = useWorkspaceStore.getState().activeId;
    const startedAt = Date.now();

    // Pre-create before IPC so the first synchronous `user-prompt` event
    // already has a conversation mapping and workspace binding.
    let conversationId = get().conversationId ?? undefined;
    if (conversationId) {
      const meta = useConversationsStore
        .getState()
        .list.find((m) => m.id === conversationId);
      // Block sends while the dock has switched workspaces but the chat
      // mirror hasn't caught up to that workspace's conversation yet.
      if (
        meta?.workspaceId &&
        activeWorkspaceId &&
        meta.workspaceId !== activeWorkspaceId
      ) {
        log.warn('send blocked during workspace switch', {
          conversationId,
          conversationWorkspaceId: meta.workspaceId,
          activeWorkspaceId
        });
        set((s) => {
          const next = applyTimelineEvent(s, {
            kind: 'error',
            id: randomId(),
            ts: Date.now(),
            message:
              'Workspace is switching — wait a moment for the chat to sync, then try again.'
          });
          return { ...s, ...next };
        });
        return;
      }
    }

    // Pin the run to the conversation's workspace when known — not the
    // transient active tab — so a mid-switch send can't stamp the wrong id.
    const workspaceId = (() => {
      if (conversationId) {
        const meta = useConversationsStore
          .getState()
          .list.find((m) => m.id === conversationId);
        if (meta?.workspaceId) return meta.workspaceId;
      }
      return activeWorkspaceId ?? undefined;
    })();
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
      const nextModelMap = { ...s.runIdToModel, [runId]: selection.modelId };
      const nextSlices = updateSlice(s.slices, boundId, (prev) => ({
        ...prev,
        runId,
        isProcessing: true,
        awaitingAskUser: false,
        runStartedAt: startedAt
      }));
      return {
        ...s,
        slices: nextSlices,
        runIdToConv: nextMap,
        runIdToModel: nextModelMap,
        ...mirrorOf(nextSlices[boundId]!)
      };
    });

    try {
      const reply = await vyotiq.chat.send({
        runId,
        prompt,
        selection,
        conversationId: boundId,
        ...(workspaceId ? { workspaceId } : {}),
        ...(options?.attachmentMeta && options.attachmentMeta.length > 0
          ? {
              attachmentMeta: options.attachmentMeta,
              ...(options.promptEventId ? { promptEventId: options.promptEventId } : {})
            }
          : options?.attachments && options.attachments.length > 0
            ? { attachments: options.attachments }
            : {}),
        ...(options?.mentions && options.mentions.length > 0
          ? { mentions: options.mentions }
          : {})
      });
      if (!reply) {
        throw new Error('chat:send rejected by main process (no reply).');
      }
      if (reply.ok === false) {
        if (reply.kind === 'unknown-conversation') {
          useToastStore
            .getState()
            .show(
              'That chat no longer exists. Start a new conversation or pick another tab.',
              'danger'
            );
        }
        set((s) => {
          const nextMap: Record<string, string> = { ...s.runIdToConv };
          delete nextMap[runId];
          const nextModelMap: Record<string, string> = { ...s.runIdToModel };
          delete nextModelMap[runId];
          const nextSlices = updateSlice(s.slices, boundId, (prev) => ({
            ...prev,
            runId: null,
            isProcessing: false,
            runStartedAt: null
          }));
          const patch = {
            slices: nextSlices,
            runIdToConv: nextMap,
            runIdToModel: nextModelMap
          };
          return s.conversationId === boundId
            ? { ...s, ...patch, ...mirrorOf(nextSlices[boundId]!) }
            : { ...s, ...patch };
        });
        return;
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
        const nextModelMap: Record<string, string> = { ...s.runIdToModel };
        delete nextModelMap[runId];
        if (targetId) {
          const nextSlices = updateSlice(s.slices, targetId, (prev) => {
            const next = applyTimelineEvent(prev, errEvent);
            return { ...prev, ...next, runId: null, isProcessing: false, runStartedAt: null };
          });
          const patch = {
            slices: nextSlices,
            runIdToConv: nextMap,
            runIdToModel: nextModelMap
          };
          return s.conversationId === targetId
            ? { ...s, ...patch, ...mirrorOf(nextSlices[targetId]!) }
            : { ...s, ...patch };
        }
        // Auto-create that never bound — surface the error on the
        // mirror so the user sees it, but there's no slice to update.
        const next = applyTimelineEvent(s, errEvent);
        return {
          ...s,
          ...next,
          runIdToConv: nextMap,
          runIdToModel: nextModelMap,
          runId: null,
          isProcessing: false,
          runStartedAt: null
        };
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
        return s.runId === id
          ? clearStreamingToolPreview({
              ...s,
              isProcessing: false,
              awaitingAskUser: false
            })
          : s;
      }
      const nextSlices = updateSlice(s.slices, convId, (prev) =>
        prev.runId === id
          ? clearStreamingToolPreview({
              ...prev,
              isProcessing: false,
              awaitingAskUser: false
            })
          : prev
      );
      return { ...s, slices: nextSlices, ...mirrorOf(nextSlices[convId]!) };
    });
    await dispatchAbortForRun(id);
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
        prev.runId === runId
          ? clearStreamingToolPreview({
              ...prev,
              isProcessing: false,
              awaitingAskUser: false
            })
          : prev
      );
      if (s.conversationId === convId) {
        return { ...s, slices: nextSlices, ...mirrorOf(nextSlices[convId]!) };
      }
      return { ...s, slices: nextSlices };
    });
    await dispatchAbortForRun(runId);
  },

  pauseForAskUser: (runId) => {
    const convId = get().runIdToConv[runId];
    if (!convId) return;
    set((s) => {
      const nextSlices = updateSlice(s.slices, convId, (prev) =>
        prev.runId === runId
          ? { ...prev, isProcessing: false, awaitingAskUser: true }
          : prev
      );
      if (s.conversationId === convId) {
        return { ...s, slices: nextSlices, ...mirrorOf(nextSlices[convId]!) };
      }
      return { ...s, slices: nextSlices };
    });
  },

  submitAskUser: async (input) => {
    const convId = input.conversationId;
    const markPromptSubmitted = (events: TimelineEvent[]) =>
      events.map((e) =>
        e.kind === 'ask-user-prompt' && e.id === input.promptEventId
          ? { ...e, status: 'submitted' as const }
          : e
      );
    set((s) => {
      const nextSlices = updateSlice(s.slices, convId, (prev) => ({
        ...prev,
        isProcessing: true,
        awaitingAskUser: false,
        draft: '',
        attachmentDraft: [],
        events: markPromptSubmitted(prev.events)
      }));
      if (s.conversationId === convId) {
        return { ...s, slices: nextSlices, ...mirrorOf(nextSlices[convId]!) };
      }
      return { ...s, slices: nextSlices };
    });
    try {
      const reply = await vyotiq.chat.submitAskUser(input);
      if (!reply.ok) {
        useToastStore
          .getState()
          .show(reply.message ?? 'Could not submit answers.', 'danger');
        set((s) => {
          const nextSlices = updateSlice(s.slices, convId, (prev) => ({
            ...prev,
            isProcessing: false,
            awaitingAskUser: true
          }));
          if (s.conversationId === convId) {
            return { ...s, slices: nextSlices, ...mirrorOf(nextSlices[convId]!) };
          }
          return { ...s, slices: nextSlices };
        });
      } else {
        useAskUserDraftStore.getState().clearDraft(input.promptEventId);
      }
    } catch (err) {
      log.warn('submitAskUser failed', { err });
      useToastStore.getState().show('Could not submit answers.', 'danger');
      set((s) => {
        const nextSlices = updateSlice(s.slices, convId, (prev) => ({
          ...prev,
          isProcessing: false,
          awaitingAskUser: true
        }));
        if (s.conversationId === convId) {
          return { ...s, slices: nextSlices, ...mirrorOf(nextSlices[convId]!) };
        }
        return { ...s, slices: nextSlices };
      });
    }
  },

  submitPendingAskUser: async (opts) => {
    const s = get();
    const pending = findPendingAskUserEvent(s.events, s.awaitingAskUser);
    if (!pending || !s.runId || !s.conversationId) return;
    const draftStore = useAskUserDraftStore.getState();
    draftStore.ensureDraft(pending.id, pending.payload);
    const answers = draftStore.buildAnswers(pending.id, pending.payload);
    const input = buildAskUserSubmitInput({
      pending,
      runId: s.runId,
      conversationId: s.conversationId,
      answers,
      supplementText: opts?.supplementText,
      attachmentMeta: opts?.attachmentMeta
    });
    await get().submitAskUser(input);
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

      const prevModels = s.runIdToModel;
      const nextModels: Record<string, string> = {};
      for (const [rid, modelId] of Object.entries(prevModels)) {
        if (snapshotMap.has(rid)) nextModels[rid] = modelId;
      }
      for (const info of infos) {
        if (info.modelId) nextModels[info.runId] = info.modelId;
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
      touched =
        touched ||
        Object.keys(nextModels).length !== Object.keys(prevModels).length;
      for (const info of infos) {
        if (!info.conversationId) continue;
        const slice = nextSlices[info.conversationId];
        if (slice && slice.runId === info.runId) continue;
        nextSlices = updateSlice(nextSlices, info.conversationId, (prev) => ({
          ...prev,
          runId: info.runId,
          isProcessing: info.awaitingUser ? false : true,
          awaitingAskUser: info.awaitingUser ?? false,
          runStartedAt: info.startedAt ?? prev.runStartedAt ?? Date.now()
        }));
        touched = true;
      }
      if (!touched) return s;
      const activeId = s.conversationId;
      if (activeId && nextSlices[activeId]) {
        return {
          ...s,
          slices: nextSlices,
          runIdToConv: nextMap,
          runIdToModel: nextModels,
          ...mirrorOf(nextSlices[activeId]!)
        };
      }
      return { ...s, slices: nextSlices, runIdToConv: nextMap, runIdToModel: nextModels };
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

  setAttachmentDraft: (conversationId, attachments) => {
    set((s) => {
      const nextSlices = updateSlice(s.slices, conversationId, (prev) => ({
        ...prev,
        attachmentDraft: attachments
      }));
      if (s.conversationId === conversationId) {
        return { ...s, slices: nextSlices, attachmentDraft: attachments };
      }
      return { ...s, slices: nextSlices };
    });
  },

  syncFollowUps: (conversationId, state) => {
    set((s) => {
      const nextSlices = updateSlice(s.slices, conversationId, (prev) => ({
        ...prev,
        followUps: {
          steering: state.steering.map((m) => ({ ...m })),
          queued: state.queued.map((m) => ({ ...m }))
        }
      }));
      if (s.conversationId === conversationId) {
        return { ...s, slices: nextSlices, followUps: nextSlices[conversationId]!.followUps };
      }
      return { ...s, slices: nextSlices };
    });
  },

  loadFollowUps: async (conversationId) => {
    if (!conversationId) return;
    try {
      const state = await vyotiq.followUps.list(conversationId);
      get().syncFollowUps(conversationId, state);
    } catch (err: unknown) {
      log.warn('loadFollowUps failed', { conversationId, err });
      const message = err instanceof Error ? err.message : String(err);
      useToastStore.getState().show(`Could not load follow-ups: ${message}`, 'danger');
    }
  },

  enqueueFollowUp: async (kind, prompt, selection, options) => {
    const conversationId = get().conversationId;
    if (!conversationId) return;
    try {
      const state = await vyotiq.followUps.enqueue({
        conversationId,
        kind,
        prompt,
        selection,
        ...(options?.attachmentMeta && options.attachmentMeta.length > 0
          ? { attachmentMeta: options.attachmentMeta }
          : {}),
        ...(options?.mentions && options.mentions.length > 0 ? { mentions: options.mentions } : {}),
        ...(options?.promptEventId ? { promptEventId: options.promptEventId } : {})
      });
      get().syncFollowUps(conversationId, state);
    } catch (err: unknown) {
      if (err instanceof FollowUpQueueFullError || (err instanceof Error && err.name === 'FollowUpQueueFullError')) {
        const maxDepth =
          err instanceof FollowUpQueueFullError ? err.maxDepth : MAX_FOLLOW_UP_QUEUE_DEPTH;
        useToastStore.getState().show(`Follow-up ${kind} lane is full (max ${maxDepth}).`, 'danger');
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      useToastStore.getState().show(message, 'danger');
    }
  },

  updateFollowUp: async (id, patch) => {
    const conversationId = get().conversationId;
    if (!conversationId) return;
    try {
      const state = await vyotiq.followUps.update({ conversationId, id, ...patch });
      get().syncFollowUps(conversationId, state);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      useToastStore.getState().show(message, 'danger');
    }
  },

  removeFollowUp: async (id) => {
    const conversationId = get().conversationId;
    if (!conversationId) return;
    try {
      const state = await vyotiq.followUps.remove({ conversationId, id });
      get().syncFollowUps(conversationId, state);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      useToastStore.getState().show(message, 'danger');
    }
  },

  sendFollowUpNow: async (id) => {
    const conversationId = get().conversationId;
    if (!conversationId) return;
    try {
      const state = await vyotiq.followUps.sendNow({ conversationId, id });
      get().syncFollowUps(conversationId, state);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      useToastStore.getState().show(message, 'danger');
    }
  },

  prewarmSlice: (conversationId, events, paging = null) => {
    if (!conversationId) return;
    set((s) => {
      // Idempotent. If a slice is already populated (in-flight run, or
      // a prior `setTranscript` already hydrated it) leave it alone —
      // overwriting could clobber tail events that arrived between the
      // disk read and this call.
      const existing = s.slices[conversationId];
      if (existing && existing.events.length > 0) return s;
      const prepared = prepareTranscriptEventsForLoad(events);
      syncSpendPromptBaseline(conversationId, prepared);
      const rebuilt = rebuildTimelineState(prepared);
      const fresh: ChatSlice = {
        ...emptySlice(conversationId),
        events: rebuilt.events,
        assistantTexts: rebuilt.assistantTexts,
        reasoningTexts: rebuilt.reasoningTexts,
        ...(rebuilt.orchestratorUsage !== undefined
          ? { orchestratorUsage: rebuilt.orchestratorUsage }
          : {}),
        ...(rebuilt.latestContextUsage !== undefined
          ? { latestContextUsage: rebuilt.latestContextUsage }
          : {}),
        ...(rebuilt.lastUserPromptId !== undefined
          ? { lastUserPromptId: rebuilt.lastUserPromptId }
          : {}),
        ...(rebuilt.lastUserPromptContent !== undefined
          ? { lastUserPromptContent: rebuilt.lastUserPromptContent }
          : {}),
        runIdToFileEditCount: rebuilt.runIdToFileEditCount,
        // Preserve any in-flight fields that may have been set by a
        // racing `rehydrateActiveRuns` for this same conversation.
        runId: existing?.runId ?? null,
        isProcessing: existing?.isProcessing ?? false,
        awaitingAskUser: existing?.awaitingAskUser ?? false,
        runStartedAt: existing?.runStartedAt ?? null,
        draft: existing?.draft ?? '',
        attachmentDraft: existing?.attachmentDraft ?? [],
        followUps: existing?.followUps ?? { ...EMPTY_FOLLOW_UP_STATE },
        transcriptPaging: paging
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
  }
}));
