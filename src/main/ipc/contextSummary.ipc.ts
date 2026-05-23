/**
 * IPC handlers for the context-summarization surface.
 *
 * Renders the seven channels declared in `@shared/constants.ts`:
 *   - `CONTEXT_SUMMARY_INSPECT`        → live messages snapshot
 *   - `CONTEXT_SUMMARY_TRIGGER_MANUAL` → fire summarizer now
 *   - `CONTEXT_SUMMARY_UNDO`           → revert a splice
 *   - `CONTEXT_SUMMARY_SET_MESSAGE_OVERRIDE` → set/clear override
 *   - `CONTEXT_SUMMARY_RESET_MESSAGE_OVERRIDES` → wipe all overrides
 *   - `CONTEXT_SUMMARY_GET_RULES`      → resolved rules read
 *   - `CONTEXT_SUMMARY_UPDATE_RULES`   → write a partial rules patch
 *
 * Plus a snapshot-changed broadcast on
 * `CONTEXT_SUMMARY_SNAPSHOT_CHANGED` that the renderer subscribes to
 * via the preload bridge.
 *
 * The runtime delegates to the orchestrator's `runContextRegistry`
 * for in-flight runs and to `overrideStore` + `conversationStore`
 * for persisted state. Settings reads/writes go through
 * `settingsStore` so the same atomic-write + cache-invalidation
 * path the rest of the app uses applies here.
 */

import { randomUUID } from 'node:crypto';
import { IPC } from '@shared/constants.js';
import type {
  ContextInspectorSnapshot,
  ContextMessageOverride,
  ContextSummaryRules
} from '@shared/types/contextSummary.js';
import {
  CONTEXT_MESSAGE_OVERRIDES,
  resolveContextSummaryRules
} from '@shared/types/contextSummary.js';
import type { AppSettings } from '@shared/types/ipc.js';
import type { TimelineEvent } from '@shared/types/chat.js';
import {
  applyOverrideEvent,
  getInspectorSnapshot,
  getOverrides,
  replayOverrideEvents
} from '../orchestrator/contextSummarizer/index.js';
import {
  abortIdleSummary,
  getIdleActiveSummaryId,
  triggerIdleSummary,
  undoIdleSummary
} from '../orchestrator/contextSummarizer/idleSummaryRuntime.js';
import {
  findActiveRunByConversation,
  getRunContext,
  listActiveRunContexts
} from '../orchestrator/runContextRegistry.js';
import {
  appendEvent,
  getConversationMeta,
  readTranscript
} from '../conversations/conversationStore.js';
import { getProspectiveMessages } from '../orchestrator/prospectiveMessages.js';
import { selectEffectiveContextWindow } from '@shared/providers/contextWindow.js';
import { listProviders } from '../providers/providerStore.js';
import { listWorkspaces } from '../workspace/workspaceState.js';
import { getSettings, setSettings } from '../settings/settingsStore.js';
import { safeWebContentsSend } from '../window/safeWebContentsSend.js';
import { probeWorkspaceOverridePresent } from '../harness/probeOverride.js';
import { logger } from '../logging/logger.js';
import { wrapIpcHandler } from './wrapIpcHandler.js';
// Audit fix 2026-06-P2-1 — id-and-shape gates for the contextSummary
// channels. Rules-patch payloads get an `assertObject` guard, per-
// message overrides route through `assertEnum` against the
// `CONTEXT_MESSAGE_OVERRIDES` allow-list, and scope strings route
// through the `'global' | 'workspace'` enum.
import {
  assertString,
  assertObject,
  assertOptionalString,
  assertEnum
} from './validate.js';
import { assertContextSummaryRulesPatch } from './contextSummaryValidate.js';

const log = logger.child('ipc/contextSummary');

const CONTEXT_SUMMARY_SCOPES = ['global', 'workspace'] as const;

/**
 * Broadcast a `CONTEXT_SUMMARY_SNAPSHOT_CHANGED` event for the
 * given runId. The renderer's Inspector listens for this and pulls
 * a fresh snapshot when its open Inspector is bound to the runId.
 *
 * Safe to call when the renderer is gone (mid-reload, window torn
 * down) — the send is a no-op behind a destroyed-window guard.
 *
 * Exported so the orchestrator's `runLoop` can call it on every
 * authoritative `token-usage` frame (Phase 5/2026 real-time
 * sync) — the inspector and the composer pill stay in lockstep
 * during a live run instead of waiting for the next manual
 * trigger / undo / override edit.
 */
export function broadcastSnapshotChanged(runId: string): void {
  // Routes through the shared `safeWebContentsSend` helper so the
  // destroyed-window guard + try/catch live in one place. The helper
  // logs at debug under its own scope; we keep the runId in a single
  // log line through the helper's structured `{ channel, err }`
  // breadcrumb (no extra logging needed here). Audit P3-3.
  safeWebContentsSend(IPC.CONTEXT_SUMMARY_SNAPSHOT_CHANGED, runId);
}

/**
 * Build the inspector snapshot for a conversation that has NO
 * active run. Delegates message-building to `getProspectiveMessages`
 * — the SAME builder the composer pill uses — so the Wire Breakdown
 * and the pill always count the same prospective payload (system
 * prompt + harness + envelopes + replayed history + tool schemas)
 * and therefore always render the same "% of context window used"
 * reading.
 *
 * Returns `null` when the conversation can't be located (a closed
 * window's stale conversationId).
 *
 * Implementation note (2026): an earlier version lazy-imported
 * `readTranscript` / `getInspectorSnapshot` / `getProspectiveMessages`
 * to dodge a circular module load between `chat.ipc` and the
 * orchestrator's `AgentV`. That cycle no longer exists — `chat.ipc`
 * doesn't import this module — so the imports are static now and
 * the `await import()` microtask tax is gone. Bundler stops warning
 * about "dynamic import will not move module into another chunk"
 * for the same reason: main-process is a single chunk.
 */
async function snapshotForIdleConversation(
  conversationId: string
): Promise<ContextInspectorSnapshot | null> {
  const meta = await getConversationMeta(conversationId);
  if (!meta) return null;
  let priorTranscript: TimelineEvent[];
  try {
    priorTranscript = await readTranscript(conversationId);
  } catch (err) {
    log.warn('snapshotForIdleConversation: readTranscript failed', {
      conversationId,
      err
    });
    return null;
  }
  // Hydrate the per-conversation override store from persisted
  // `context-override-set` events so the inspector's per-message
  // Keep/Summarize/Drop toggles reflect the user's prior choices.
  // Mirrors `buildInitialMessages`'s hydration in `AgentV.ts`.
  const overrideEvents = priorTranscript.filter(
    (e): e is Extract<TimelineEvent, { kind: 'context-override-set' }> =>
      e.kind === 'context-override-set'
  );
  replayOverrideEvents(conversationId, overrideEvents);

  // Resolve rules + ceiling for the snapshot's footer/gauge.
  const settings = await getSettings();
  const rules = resolveContextSummaryRules(
    settings.contextSummary,
    meta.workspaceId
      ? settings.ui?.contextSummaryByWorkspace?.[meta.workspaceId]
      : undefined
  );
  // Best-effort ceiling: use the conversation's last-known model
  // when present (transcript meta) — the renderer caller can
  // refresh once the user picks a model via the composer.
  let ceiling: number | undefined;
  const modelId = meta.lastModelId ?? '';
  if (meta.lastProviderId && meta.lastModelId) {
    try {
      const providers = await listProviders();
      ceiling = selectEffectiveContextWindow(
        providers,
        meta.lastProviderId,
        meta.lastModelId
      );
    } catch (err) {
      log.debug('idle ceiling resolve failed', { err });
    }
  }
  // `meta.workspaceId` is `string | undefined` on legacy entries
  // (pre-multi-workspace). Treat the absence as the empty string —
  // the renderer's Inspector renders a soft "(unknown workspace)"
  // label and disables the workspace-override badge.
  const wsId = meta.workspaceId ?? '';
  // Resolve the workspace's filesystem path so we can probe the
  // optional `.vyotiq/context-summarizer.md` override file. Without
  // the path, the badge would always render as "bundled" even when
  // the user has a workspace override in effect.
  let workspacePath: string | undefined;
  if (meta.workspaceId) {
    try {
      const wsState = await listWorkspaces();
      const entry = wsState.workspaces.find((w) => w.id === meta.workspaceId);
      workspacePath = entry?.path;
    } catch (err) {
      log.debug('idle workspacePath resolve failed', { err });
    }
  }
  const workspaceOverridePresent = await probeWorkspaceOverridePresent(workspacePath);
  // When an idle summary is in flight for this conversation,
  // surface its active summaryId on the snapshot so the Inspector
  // can subscribe to the streaming `summaries[id]` accumulator
  // immediately. The Inspector's `LiveStreamCard` renders from
  // that field; the renderer reducer populates the accumulator
  // from `context-summary-pending` events that ride the same
  // `CHAT_EVENT` channel, so the two views stay in lockstep.
  const activeIdleSummaryId = getIdleActiveSummaryId(conversationId);

  // Single source of truth — `getProspectiveMessages` builds the
  // exact prospective `messages[]` the next request would carry
  // (system prompt + harness + envelopes + replayed history with
  // any persisted summary splices applied) and the same `tools[]`
  // catalogue the orchestrator emits on the wire. This is the
  // payload the composer pill tokenizes; the inspector consumes
  // the same builder so its Wire Breakdown is consistent with the
  // pill by construction.
  const prospect = await getProspectiveMessages(conversationId);
  return getInspectorSnapshot({
    conversationId,
    workspaceId: wsId,
    messages: prospect.messages,
    tools: prospect.tools,
    rules,
    workspaceOverridePresent,
    modelId,
    ...(ceiling !== undefined ? { ceiling } : {}),
    ...(activeIdleSummaryId !== undefined ? { activeSummaryId: activeIdleSummaryId } : {})
  });
}

export function registerContextSummaryIpc(): void {
  // ── inspect ───────────────────────────────────────────────────────
  wrapIpcHandler(
    IPC.CONTEXT_SUMMARY_INSPECT,
    async (
      _event,
      runId: string
    ): Promise<ContextInspectorSnapshot | null> => {
      assertString('contextSummary:inspect', 'runId', runId);
      const handle = getRunContext(runId);
      if (handle) {
        try {
          return await handle.snapshot();
        } catch (err) {
          log.warn('inspect: live snapshot failed', { runId, err });
          return null;
        }
      }
      // No active run — fall back to the persisted-initial-messages
      // snapshot. Renderer treats `runId` as a conversationId in
      // this branch (the inspector pill carries one when the
      // composer is between runs). Probe both interpretations
      // before giving up.
      const idle = await snapshotForIdleConversation(runId);
      if (idle) return idle;
      return null;
    }
  );

  // ── trigger manual ────────────────────────────────────────────────
  wrapIpcHandler(
    IPC.CONTEXT_SUMMARY_TRIGGER_MANUAL,
    async (
      _event,
      idOrConversationId: string,
      idleRunId?: string
    ): Promise<
      | { ok: true; summaryId: string; idleRunId?: string }
      | { ok: false; reason: string }
    > => {
      assertString('contextSummary:triggerManual', 'idOrConversationId', idOrConversationId);
      assertOptionalString('contextSummary:triggerManual', 'idleRunId', idleRunId);
      // Live path: the id resolves to an active orchestrator run.
      // Behaviour is identical to the original handler — the
      // synchronous in-flight gate inside `runLoop`'s
      // `triggerManual` callback rejects double-clicks cleanly.
      const handle = getRunContext(idOrConversationId);
      if (handle) {
        const result = await handle.triggerManual();
        if (result.ok) broadcastSnapshotChanged(idOrConversationId);
        return result;
      }
      // Idle path: no active run for the id, so treat it as a
      // conversationId and run the summarizer off-line. The
      // caller (renderer store) supplied `idleRunId` and has
      // already registered the synthetic runId in its dispatch
      // table so the upcoming `CHAT_EVENT` broadcasts route into
      // the right slice.
      if (typeof idleRunId !== 'string' || idleRunId.length === 0) {
        return {
          ok: false,
          reason: 'No active run for this id'
        };
      }
      const result = await triggerIdleSummary(idOrConversationId, idleRunId);
      if (result.ok) {
        // Snapshot-changed broadcasts route by `runId`; we want
        // the open Inspector (bound to the conversationId in
        // idle mode) to refresh too. Sending the conversationId
        // matches the bound id the Inspector subscribed against.
        broadcastSnapshotChanged(idOrConversationId);
        return { ok: true, summaryId: result.summaryId, idleRunId: result.runId };
      }
      return result;
    }
  );

  // ── undo ──────────────────────────────────────────────────────────
  wrapIpcHandler(
    IPC.CONTEXT_SUMMARY_UNDO,
    async (
      _event,
      runIdOrConversationId: string,
      summaryId: string
    ): Promise<{ ok: boolean; event?: TimelineEvent }> => {
      assertString('contextSummary:undo', 'runIdOrConversationId', runIdOrConversationId);
      assertString('contextSummary:undo', 'summaryId', summaryId);
      const handle = getRunContext(runIdOrConversationId);
      if (handle) {
        const result = await handle.undo(summaryId);
        if (result.ok) broadcastSnapshotChanged(runIdOrConversationId);
        return result;
      }
      const meta = await getConversationMeta(runIdOrConversationId);
      if (!meta) return { ok: false };
      const result = await undoIdleSummary(runIdOrConversationId, summaryId);
      if (result.ok) broadcastSnapshotChanged(runIdOrConversationId);
      return result;
    }
  );

  // ── abort idle summary ────────────────────────────────────────────
  wrapIpcHandler(
    IPC.CONTEXT_SUMMARY_ABORT_IDLE,
    async (_event, conversationId: string): Promise<{ ok: boolean }> => {
      assertString('contextSummary:abortIdle', 'conversationId', conversationId);
      return { ok: abortIdleSummary(conversationId) };
    }
  );

  // ── abort live-run summary (orchestrator only) ────────────────────
  wrapIpcHandler(
    IPC.CONTEXT_SUMMARY_ABORT_LIVE,
    async (_event, runId: string): Promise<{ ok: boolean }> => {
      assertString('contextSummary:abortLive', 'runId', runId);
      const handle = getRunContext(runId);
      if (!handle) return { ok: false };
      return { ok: handle.abortSummary() };
    }
  );

  // ── set message override ──────────────────────────────────────────
  wrapIpcHandler(
    IPC.CONTEXT_SUMMARY_SET_MESSAGE_OVERRIDE,
    async (
      _event,
      conversationId: string,
      messageId: string,
      override: ContextMessageOverride | null
    ): Promise<void> => {
      assertString('contextSummary:setMessageOverride', 'conversationId', conversationId);
      // `messageId` may be the reset-all sentinel `'*'` so we accept
      // any non-empty string; the body-level check below catches the
      // `(messageId === '*' && override !== null)` misuse.
      assertString('contextSummary:setMessageOverride', 'messageId', messageId);
      // `override` is the string-literal union `'keep' | 'summarize' | 'drop'`
      // (or `null` to clear). Earlier audit-fix iteration used
      // `assertObject` here, which is incorrect for a primitive
      // payload and rejected every legitimate Inspector toggle with
      // `override must be a non-null object`. Source-of-truth list
      // lives in `CONTEXT_MESSAGE_OVERRIDES` so the renderer toggle,
      // the type system, and this validator stay in lockstep.
      if (override !== null) {
        assertEnum(
          'contextSummary:setMessageOverride',
          'override',
          override,
          CONTEXT_MESSAGE_OVERRIDES
        );
      }
      // M1: reject the `(messageId === '*', override !== null)`
      // corner the `overrideStore` doc-block claims is "rejected
      // upstream by the IPC handler". The store defensively
      // converts the combination to a clear-all, but routing this
      // shape through `set` is unambiguously a caller bug — the
      // dedicated `RESET_MESSAGE_OVERRIDES` IPC exists for the
      // clear-all path. Throwing here keeps the documented
      // contract honest and surfaces the misuse to the renderer.
      if (messageId === '*' && override !== null) {
        throw new Error(
          'contextSummary.setMessageOverride: messageId="*" requires override=null. ' +
          'Use resetMessageOverrides for clear-all.'
        );
      }
      const event: TimelineEvent = {
        kind: 'context-override-set',
        id: randomUUID(),
        ts: Date.now(),
        messageId,
        override
      };
      // H4: persist to the JSONL BEFORE flipping the in-memory
      // store, so a disk failure (full disk, OneDrive lock,
      // antivirus EBUSY) doesn't leave the live partition ahead
      // of disk — which would surface as "override took effect,
      // app restart loses it". On `appendEvent` throw we surface
      // the error to the renderer (which catches via the
      // useContextSummaryStore's `error` slot and renders a
      // toast). The in-memory commit only happens after the
      // persistence handshake succeeds.
      await appendEvent(conversationId, event);
      applyOverrideEvent(conversationId, event);
      // If a run is in flight for this conversation, route the
      // event through its emit sink so the renderer's reducer
      // mirror updates synchronously and the snapshot-changed
      // broadcast targets the right runId.
      const handle = findActiveRunByConversation(conversationId);
      if (handle) {
        broadcastSnapshotChanged(handle.runId);
      }
    }
  );

  // ── reset message overrides ───────────────────────────────────────
  wrapIpcHandler(
    IPC.CONTEXT_SUMMARY_RESET_MESSAGE_OVERRIDES,
    async (_event, conversationId: string): Promise<void> => {
      assertString('contextSummary:resetMessageOverrides', 'conversationId', conversationId);
      const event: TimelineEvent = {
        kind: 'context-override-set',
        id: randomUUID(),
        ts: Date.now(),
        // Sentinel for reset-all. `messageWindow.RESET_ALL_OVERRIDES_SENTINEL`
        // is the same `'*'` value; we don't import it here to avoid
        // re-pulling the orchestrator-side module into the IPC layer
        // — the contract is documented in the override-store
        // doc-block.
        messageId: '*',
        override: null
      };
      // H4: persist BEFORE flipping the in-memory store. Same
      // rationale as the set-message-override handler above.
      await appendEvent(conversationId, event);
      applyOverrideEvent(conversationId, event);
      const handle = findActiveRunByConversation(conversationId);
      if (handle) broadcastSnapshotChanged(handle.runId);
    }
  );

  // ── get rules ─────────────────────────────────────────────────────
  wrapIpcHandler(
    IPC.CONTEXT_SUMMARY_GET_RULES,
    async (
      _event,
      workspaceId: string | null
    ): Promise<ContextSummaryRules> => {
      // `workspaceId` is the resolve key for per-workspace overrides;
      // `null` selects the global resolution. Validate the non-null
      // case only.
      if (workspaceId !== null) {
        assertString('contextSummary:getRules', 'workspaceId', workspaceId);
      }
      const settings = await getSettings();
      const global = settings.contextSummary;
      const workspace = workspaceId
        ? settings.ui?.contextSummaryByWorkspace?.[workspaceId]
        : undefined;
      return resolveContextSummaryRules(global, workspace);
    }
  );

  // ── update rules ──────────────────────────────────────────────────
  wrapIpcHandler(
    IPC.CONTEXT_SUMMARY_UPDATE_RULES,
    async (
      _event,
      scope: 'global' | 'workspace',
      patch: Partial<ContextSummaryRules>,
      workspaceId?: string
    ): Promise<AppSettings> => {
      assertEnum('contextSummary:updateRules', 'scope', scope, CONTEXT_SUMMARY_SCOPES);
      assertObject('contextSummary:updateRules', 'patch', patch);
      assertContextSummaryRulesPatch('contextSummary:updateRules', patch);
      assertOptionalString('contextSummary:updateRules', 'workspaceId', workspaceId);
      const current = await getSettings();
      let next: Partial<AppSettings>;
      if (scope === 'global') {
        next = {
          contextSummary: {
            ...(current.contextSummary ?? {}),
            ...patch
          }
        };
      } else {
        if (!workspaceId) {
          throw new Error('updateRules: workspaceId is required for scope:"workspace"');
        }
        const prevByWs =
          current.ui?.contextSummaryByWorkspace?.[workspaceId] ?? {};
        next = {
          ui: {
            ...(current.ui ?? {}),
            contextSummaryByWorkspace: {
              ...(current.ui?.contextSummaryByWorkspace ?? {}),
              [workspaceId]: {
                ...prevByWs,
                ...patch
              }
            }
          }
        };
      }
      const refreshed = await setSettings(next);
      // Snapshot-changed for every active run on the affected
      // workspace (or every run when scope:'global'). Lets any
      // open Inspector refresh against the new rules without a
      // manual reload.
      for (const { runId } of listActiveRunContexts()) {
        const handle = getRunContext(runId);
        if (!handle) continue;
        if (scope === 'workspace' && handle.workspaceId !== workspaceId) continue;
        broadcastSnapshotChanged(runId);
      }
      return refreshed;
    }
  );

  // The `getOverrides` symbol is currently used only by the
  // orchestrator's snapshot path; reference it here so future
  // IPC additions that surface raw overrides (e.g. an export) can
  // import directly without re-wiring. Eliminates a dead-import
  // warning today.
  void getOverrides;
}
