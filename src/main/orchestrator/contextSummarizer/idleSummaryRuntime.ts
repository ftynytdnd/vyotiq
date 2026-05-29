/**
 * Idle-mode manual context summarization.
 *
 * The live-run path goes:
 *
 *     orchestrator.runLoop → registerRunContext → IPC.triggerManual
 *       → handle.triggerManual → maybeRunSummarization
 *       → streamSummary (emits via runLoop's emit sink)
 *       → applySummary (mutates messages[] in place)
 *
 * After the run terminates, `runContextRegistry` no longer holds a
 * handle, so the IPC bails with "No active run for this id". The
 * Inspector's `mode === 'idle'` branch reflects that and disables
 * the trigger.
 *
 * THIS module fills the gap. It owns the idle path end-to-end:
 *
 *   1. Mints a synthetic `runId` (kept inside this module — never
 *      written to the orchestrator's `activeRuns` map and never
 *      registered in `runContextRegistry`, so the orchestrator-only
 *      semantics around in-flight runs stay clean).
 *   2. Re-builds the conversation's `messages[]` from the persisted
 *      JSONL via the same `replayTranscript` + override + summary
 *      replay path the next `chat:send` would take.
 *   3. Runs `maybeRunSummarization` against that array with an
 *      `emit` shim that
 *        - broadcasts to the renderer through `CHAT_EVENT` (same
 *          channel the live path uses, so `LiveStreamCard` paints
 *          unchanged), and
 *        - persists each event through `appendEvent` so the next
 *          `chat:send` re-applies the same splice via
 *          `replayCompression` — no live `messages[]` mutation is
 *          needed because there is no live `messages[]`.
 *   4. Gates concurrency: at most one idle summary per conversation,
 *      and the `chat:send` IPC awaits any in-flight idle summary so
 *      a new prompt can never race a still-streaming compression.
 *
 * Reuses everything: `streamSummary`, the partition pass, the
 * tokenBudget BPE estimator, the `<context_summary>` envelope,
 * the renderer reducer's `summaries[id]` accumulator, and the
 * `replayCompression` walk on the next send. The only new code is
 * the registry + the emit shim + a tiny IPC route registration so
 * the renderer can map the synthetic runId to the right slice
 * before any events arrive.
 */

import { randomUUID } from 'node:crypto';
import type { TimelineEvent, ChatMessage } from '@shared/types/chat.js';
import { IPC } from '@shared/constants.js';
import { resolveContextSummaryRules } from '@shared/types/contextSummary.js';
import type { ModelSelection } from '@shared/types/provider.js';
import { appendEvent, getConversationMeta, drainAppendChain, readTranscript } from '../../conversations/conversationStore.js';
import { getSettings } from '../../settings/settingsStore.js';
import { safeWebContentsSend } from '../../window/safeWebContentsSend.js';
import { listProviders } from '../../providers/providerStore.js';
import { listWorkspaces } from '../../workspace/workspaceState.js';
import { logger } from '../../logging/logger.js';
import { replayTranscript } from '../replay/index.js';
import {
  maybeRunSummarization,
  replayCompression,
  replayOverrideEvents,
  clearForRun
} from './index.js';

const log = logger.child('orchestrator/contextSummarizer/idleSummaryRuntime');

/**
 * In-flight idle summary record. One per conversation. Owns the
 * synthetic runId, the AbortController so an external caller can
 * cancel it, and the `done` promise so `chat:send` can await
 * settlement before reading the JSONL.
 */
interface IdleHandle {
  runId: string;
  conversationId: string;
  abort: AbortController;
  done: Promise<void>;
  /** Populated once the first `context-summary-pending` event has
   *  been minted by `streamSummary`. Read by the snapshot path so
   *  the Inspector's `LiveStreamCard` can subscribe to the right
   *  `summaries[id]` accumulator before any deltas land. */
  summaryId?: string;
}

const idleHandles = new Map<string, IdleHandle>();

/**
 * Wait for any in-flight idle summary on the conversation to settle.
 * Resolves immediately when no handle exists. Used by `chat:send`
 * before reading the JSONL transcript so a new prompt always sees
 * the post-summarization shape on disk.
 *
 * Never throws — internal failures of the idle summary are surfaced
 * through the persisted `context-summary-aborted` event the renderer
 * already understands.
 */
export async function awaitIdleSummary(conversationId: string): Promise<void> {
  const handle = idleHandles.get(conversationId);
  if (!handle) return;
  try {
    await handle.done;
  } catch {
    /* internal failures are surfaced via the persisted aborted event */
  }
}

/**
 * Abort any in-flight idle summary on the conversation. Used by
 * `chat:send`'s supersede path so the user's new prompt cancels a
 * still-streaming idle compression instead of waiting on it. The
 * `done` promise still settles cleanly via the AbortError branch
 * inside `streamSummary`; callers who want to await settlement
 * after aborting should chain `awaitIdleSummary`.
 */
export function abortIdleSummary(conversationId: string): boolean {
  const handle = idleHandles.get(conversationId);
  if (!handle) return false;
  handle.abort.abort();
  return true;
}

/**
 * Cancel idle summarization by synthetic `runId` (Composer Stop /
 * `chat:abort` defense when the renderer routes through the wrong IPC).
 */
export function abortIdleSummaryByRunId(runId: string): boolean {
  for (const handle of idleHandles.values()) {
    if (handle.runId !== runId) continue;
    handle.abort.abort();
    return true;
  }
  return false;
}

/** Drain every in-flight idle summary at app shutdown. */
export function abortAllIdleSummaries(): void {
  for (const conversationId of [...idleHandles.keys()]) {
    abortIdleSummary(conversationId);
  }
}

/**
 * True when an idle summary is currently streaming for the
 * conversation. The renderer surfaces this through the Inspector's
 * "Summarize now" button gate; the IPC handler also checks this
 * before accepting a fresh trigger so two manual clicks can't race.
 */
export function hasIdleSummary(conversationId: string): boolean {
  return idleHandles.has(conversationId);
}

/**
 * Read the synthetic runId of an in-flight idle summary, when one
 * exists. The IPC `inspect` handler reuses this so an Inspector
 * opened against a conversation while an idle summary is streaming
 * sees the live `activeSummaryId` slot populated and routes the
 * `LiveStreamCard` to the same `summaries[id]` accumulator the
 * timeline already paints.
 */
/**
 * Read the active summaryId for an idle summary that has already
 * emitted its `context-summary-pending` event. Returns `undefined`
 * when no idle summary is in flight or the pending event has not
 * landed yet (the very first inspect call may race that event;
 * the `onSnapshotChanged` broadcast picks up the difference on
 * the very next pending-driven re-render).
 */
export function getIdleActiveSummaryId(
  conversationId: string
): string | undefined {
  return idleHandles.get(conversationId)?.summaryId;
}

/**
 * Resolve the summarizer model for an idle conversation:
 *   1. `rules.summarizerSelection` when pinned (matches the live
 *      path's preference).
 *   2. The conversation's persisted last-used `(providerId, modelId)`
 *      from `ConversationMeta`. Verified against `listProviders`
 *      so a stale id from a deleted provider falls through.
 *   3. Otherwise null — caller surfaces a "pick a model" reason.
 */
async function resolveSummarizerSelection(
  conversationId: string,
  rulesSelection: ModelSelection | null
): Promise<{ ok: true; selection: ModelSelection } | { ok: false; reason: string }> {
  if (rulesSelection) {
    const providers = await listProviders();
    if (providers.some((p) => p.id === rulesSelection.providerId)) {
      return { ok: true, selection: rulesSelection };
    }
    log.warn('idle summary: pinned summarizer provider missing; falling back', {
      providerId: rulesSelection.providerId
    });
  }
  const meta = await getConversationMeta(conversationId);
  if (meta?.lastProviderId && meta.lastModelId) {
    const providers = await listProviders();
    if (providers.some((p) => p.id === meta.lastProviderId)) {
      return {
        ok: true,
        selection: {
          providerId: meta.lastProviderId,
          modelId: meta.lastModelId
        }
      };
    }
  }
  return {
    ok: false,
    reason:
      'No summarizer model available. Open this conversation, pick a model in the composer, then try again.'
  };
}

/**
 * Locate the workspace path for the conversation. Returns
 * `undefined` when the workspace isn't registered (deleted or
 * pre-multi-workspace transcript) — `streamSummary` accepts the
 * undefined and falls back to the bundled summarizer prompt.
 */
async function resolveWorkspacePath(workspaceId: string | undefined): Promise<string | undefined> {
  if (!workspaceId) return undefined;
  try {
    const wsState = await listWorkspaces();
    return wsState.workspaces.find((w) => w.id === workspaceId)?.path;
  } catch (err) {
    log.debug('idle summary: workspace lookup failed', { err });
    return undefined;
  }
}

/**
 * Re-build the conversation's `messages[]` from persisted JSONL so
 * the partition + summarizer see exactly what the next `chat:send`
 * would replay. Mirrors `AgentV.buildInitialMessages`'s replay
 * path minus the new-user envelope (we're between turns, not
 * sending one).
 */
async function buildIdleMessages(conversationId: string): Promise<ChatMessage[] | null> {
  await drainAppendChain(conversationId);
  const transcript = await readTranscript(conversationId);
  if (transcript.length === 0) return null;
  const overrideEvents = transcript.filter(
    (e): e is Extract<TimelineEvent, { kind: 'context-override-set' }> =>
      e.kind === 'context-override-set'
  );
  replayOverrideEvents(conversationId, overrideEvents);
  const messages = replayTranscript(transcript);
  const summaryEvents = transcript.filter(
    (e): e is Extract<
      TimelineEvent,
      | { kind: 'context-summary-pending' }
      | { kind: 'context-summary-end' }
      | { kind: 'context-summary-undone' }
    > =>
      e.kind === 'context-summary-pending' ||
      e.kind === 'context-summary-end' ||
      e.kind === 'context-summary-undone'
  );
  if (summaryEvents.length > 0) replayCompression(messages, summaryEvents);
  // The orchestrator's runtime always carries an empty system slot
  // at index 0 (rebuilt per iteration). Mirror that here so the
  // partition's `preserveFirstSystem` rule has the same anchor.
  return [{ role: 'system', content: '' }, ...messages];
}

/**
 * Send a `CHAT_EVENT` to the renderer for the synthetic runId.
 * Best-effort: a destroyed window is a no-op. Routes through the
 * shared `safeWebContentsSend` helper so the destroyed-window guard +
 * try/catch live in one place. Audit P3-3 (2026-05). Failures here
 * can't tank the in-flight summary because the same event is also
 * persisted via `appendEvent`.
 */
function broadcast(runId: string, event: TimelineEvent): void {
  safeWebContentsSend(IPC.CHAT_EVENT, runId, event);
}

/**
 * Revert a persisted idle summary splice by appending
 * `context-summary-undone` to the JSONL. Only valid when the
 * summary has ended, has not already been undone, and no
 * subsequent `user-prompt` has landed (turn boundary).
 */
export async function undoIdleSummary(
  conversationId: string,
  summaryId: string
): Promise<{ ok: boolean; event?: TimelineEvent }> {
  await drainAppendChain(conversationId);
  const transcript = await readTranscript(conversationId);

  let endIndex = -1;
  let hasEnd = false;
  let undone = false;
  for (let i = 0; i < transcript.length; i++) {
    const e = transcript[i]!;
    if (e.kind === 'context-summary-end' && e.summaryId === summaryId) {
      hasEnd = true;
      endIndex = i;
    }
    if (e.kind === 'context-summary-undone' && e.summaryId === summaryId) {
      undone = true;
    }
  }
  if (!hasEnd || undone) return { ok: false };

  for (let i = endIndex + 1; i < transcript.length; i++) {
    if (transcript[i]!.kind === 'user-prompt') return { ok: false };
  }

  const event: TimelineEvent = {
    kind: 'context-summary-undone',
    id: randomUUID(),
    ts: Date.now(),
    summaryId
  };
  await appendEvent(conversationId, event);

  return { ok: true, event };
}

/**
 * Result of `triggerIdleSummary`. Mirrors the live `triggerManual`
 * IPC return shape so the renderer's existing button + toast paths
 * are reused unchanged.
 */
export type IdleTriggerResult =
  | { ok: true; summaryId: string; runId: string }
  | { ok: false; reason: string };

/**
 * Start an idle-mode manual summarization for the given
 * conversation. Returns once the synthetic runId has been minted
 * and registered (so the renderer can route the upcoming events);
 * the actual streaming continues asynchronously and surfaces
 * through the existing `CHAT_EVENT` channel + JSONL persistence.
 *
 * `runId` is supplied by the caller (the IPC layer mints it after
 * the renderer has pre-registered the `runId → conversationId`
 * route in its dispatch table). Mirrors the live `chat:send` path
 * where the renderer mints the runId, flips its slice to
 * `isProcessing`, and only then calls the IPC.
 *
 * Concurrency: rejects when an idle summary is already in flight
 * for this conversation. Rejection is friendly so a double-click
 * surfaces a clean toast instead of a generic error.
 */
export async function triggerIdleSummary(
  conversationId: string,
  runId: string
): Promise<IdleTriggerResult> {
  if (idleHandles.has(conversationId)) {
    return { ok: false, reason: 'A summary is already in flight for this conversation' };
  }

  const meta = await getConversationMeta(conversationId);
  if (!meta) {
    return { ok: false, reason: 'Unknown conversation' };
  }

  const settings = await getSettings();
  const rules = resolveContextSummaryRules(
    settings.contextSummary,
    meta.workspaceId
      ? settings.ui?.contextSummaryByWorkspace?.[meta.workspaceId]
      : undefined
  );
  if (!rules.enabled) {
    return { ok: false, reason: 'Context summarization is disabled in settings' };
  }

  const summarizerSelection = await resolveSummarizerSelection(
    conversationId,
    rules.summarizerSelection
  );
  if (!summarizerSelection.ok) return summarizerSelection;

  const messages = await buildIdleMessages(conversationId);
  if (!messages) {
    return { ok: false, reason: 'Conversation has no events to summarize' };
  }

  const workspacePath = await resolveWorkspacePath(meta.workspaceId);
  // Anchor `<task>` to the first user-prompt of the conversation —
  // the live path uses `input.prompt`, which is the run's anchor.
  // The first persisted user prompt is the closest equivalent
  // available off-line. Falls back to the conversation title when
  // even that's missing (legacy transcripts), so the summarizer
  // always has a non-empty `<task>` block to work with.
  const transcript = await readTranscript(conversationId);
  const firstPrompt = transcript.find((e) => e.kind === 'user-prompt');
  const originalPrompt =
    (firstPrompt && firstPrompt.kind === 'user-prompt' ? firstPrompt.content : null) ??
    meta.title ??
    'Conversation summary';

  // Use the caller-supplied synthetic runId. The renderer routes
  // by this id; the orchestrator's `activeRuns` and
  // `runContextRegistry` are NOT touched so any code that lists
  // in-flight orchestrator runs (dock processing indicators,
  // abort cascades) stays accurate.
  const abort = new AbortController();

  // Resolve once; `done` settles after streamSummary returns. The
  // promise is held in `idleHandles` so external callers can await
  // settlement (`awaitIdleSummary`) without coupling to the IPC.
  let resolveDone!: () => void;
  const done = new Promise<void>((r) => {
    resolveDone = r;
  });
  idleHandles.set(conversationId, { runId, conversationId, abort, done });

  // Telemetry — parity with the live path's "manual summarization
  // failed" warn line. The IPC broadcast `onSnapshotChanged` for
  // any open Inspector observing this conversation also fires
  // through the same `CHAT_EVENT` flow.
  log.info('idle summary started', {
    runId,
    conversationId,
    workspaceId: meta.workspaceId
  });

  // Fire-and-forget run. The caller's promise resolves immediately
  // once the handle is registered. Errors inside the summarizer
  // emit a `context-summary-aborted` event (handled by
  // `streamSummary` itself); we still surface a `chat:done` /
  // `chat:error` to fulfill the renderer's run-finalisation
  // contract, then drop the handle.
  let summaryId = '';
  let idleAppendChain: Promise<void> = Promise.resolve();
  void (async () => {
    try {
      const result = await maybeRunSummarization({
        runId,
        conversationId,
        ...(workspacePath !== undefined ? { workspacePath } : {}),
        messages,
        rules,
        summarizerSelection: summarizerSelection.selection,
        trigger: 'manual',
        originalPrompt,
        signal: abort.signal,
        emit: (event: TimelineEvent) => {
          // Capture the summaryId from the very first pending event so
          // an Inspector opened mid-stream can resolve the active
          // accumulator; broadcast snapshot-changed for both the
          // synthetic runId AND the conversationId the renderer
          // bound to in idle mode.
          if (event.kind === 'context-summary-pending') {
            const handle = idleHandles.get(conversationId);
            if (handle) handle.summaryId = event.summaryId;
          }
          // Persist BEFORE broadcasting so a renderer reload mid-
          // stream sees the same shape on disk it just observed
          // through the live channel. Serialized through
          // `idleAppendChain` so JSONL order matches broadcast order.
          idleAppendChain = idleAppendChain.then(async () => {
            try {
              await appendEvent(conversationId, event);
            } catch (err) {
              log.warn('idle summary appendEvent failed', {
                conversationId,
                kind: event.kind,
                err
              });
            }
            broadcast(runId, event);
          });
        }
      });
      await idleAppendChain;
      if (result.ok) summaryId = result.summaryId;
    } catch (err) {
      // `maybeRunSummarization` swallows provider/abort errors and
      // returns `{ ok: false }`. Anything reaching here is a logic
      // bug — log it and synthesize a clean aborted marker so the
      // renderer doesn't see a half-streamed accumulator.
      const reason = err instanceof Error ? err.message : String(err);
      log.error('idle summary internal failure', { runId, reason });
      const fakeId = randomUUID();
      const aborted: TimelineEvent = {
        kind: 'context-summary-aborted',
        id: randomUUID(),
        ts: Date.now(),
        summaryId: fakeId,
        reason
      };
      await idleAppendChain;
      try {
        await appendEvent(conversationId, aborted);
      } catch {
        /* logged in appendEvent */
      }
      broadcast(runId, aborted);
    } finally {
      // Settle the renderer's run-state mirror cleanly via
      // `chat:done`. The store's `finishRun` clears the
      // `runIdToConv` slot we registered on the renderer side
      // through `bindRoute` and prunes any per-summary buffers.
      // Routes through the shared `safeWebContentsSend` helper.
      // Audit P3-3 (2026-05).
      safeWebContentsSend(IPC.CHAT_DONE, runId);
      idleHandles.delete(conversationId);
      clearForRun(runId);
      resolveDone();
      log.info('idle summary settled', { runId, conversationId, summaryId });
    }
  })();

  // Pre-mint the summaryId path: we cannot know it until the
  // first `context-summary-pending` event lands inside
  // `streamSummary`. Return the synthetic runId so the renderer
  // can register the route before events arrive; the matching
  // `summaryId` is published on the persisted pending event and
  // the renderer reducer routes by that id from there on.
  return { ok: true, summaryId: '', runId };
}
