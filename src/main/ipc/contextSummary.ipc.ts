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
import { resolveContextSummaryRules } from '@shared/types/contextSummary.js';
import type { AppSettings } from '@shared/types/ipc.js';
import type { TimelineEvent } from '@shared/types/chat.js';
import {
  applyOverrideEvent,
  getOverrides
} from '../orchestrator/contextSummarizer/index.js';
import {
  findActiveRunByConversation,
  getRunContext
} from '../orchestrator/runContextRegistry.js';
import {
  appendEvent,
  getConversationMeta
} from '../conversations/conversationStore.js';
import { getSettings, setSettings } from '../settings/settingsStore.js';
import { getMainWindow } from '../window/getMainWindow.js';
import { probeWorkspaceOverridePresent } from '../harness/probeOverride.js';
import { logger } from '../logging/logger.js';
import { wrapIpcHandler } from './wrapIpcHandler.js';

const log = logger.child('ipc/contextSummary');

/**
 * Broadcast a `CONTEXT_SUMMARY_SNAPSHOT_CHANGED` event for the
 * given runId. The renderer's Inspector listens for this and pulls
 * a fresh snapshot when its open Inspector is bound to the runId.
 *
 * Safe to call when the renderer is gone (mid-reload, window torn
 * down) — the send is a no-op behind a destroyed-window guard.
 */
function broadcastSnapshotChanged(runId: string): void {
  try {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return;
    const wc = win.webContents;
    if (!wc || wc.isDestroyed()) return;
    wc.send(IPC.CONTEXT_SUMMARY_SNAPSHOT_CHANGED, runId);
  } catch (err) {
    log.debug('snapshot-changed broadcast failed', { runId, err });
  }
}

/**
 * Build the inspector snapshot for a conversation that has NO
 * active run. Falls back to the persisted initial-messages state
 * by replaying the transcript through `replayTranscript` +
 * `replayCompression`. Returns `null` when the conversation can't
 * be located (a closed window's stale conversationId).
 *
 * Implementation: lazy-imports the orchestrator helpers to avoid a
 * circular module load between `chat.ipc` (which imports this) and
 * the orchestrator's `AgentV`. Cheap on first call, cached after.
 */
async function snapshotForIdleConversation(
  conversationId: string
): Promise<ContextInspectorSnapshot | null> {
  const meta = await getConversationMeta(conversationId);
  if (!meta) return null;
  const { readTranscript } = await import('../conversations/conversationStore.js');
  const { replayTranscript } = await import('../orchestrator/replay/index.js');
  const {
    getInspectorSnapshot,
    replayCompression,
    replayOverrideEvents
  } = await import('../orchestrator/contextSummarizer/index.js');
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
  // Hydrate overrides + summaries the same way `buildInitialMessages`
  // does at run start, so the idle-snapshot view matches what the
  // next run will see.
  const overrideEvents = priorTranscript.filter(
    (e): e is Extract<TimelineEvent, { kind: 'context-override-set' }> =>
      e.kind === 'context-override-set'
  );
  replayOverrideEvents(conversationId, overrideEvents);
  const messages = replayTranscript(priorTranscript);
  const summaryEvents = priorTranscript.filter(
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
      const { selectEffectiveContextWindow } = await import(
        '@shared/providers/contextWindow.js'
      );
      const { listProviders } = await import('../providers/providerStore.js');
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
      const { listWorkspaces } = await import('../workspace/workspaceState.js');
      const wsState = await listWorkspaces();
      const entry = wsState.workspaces.find((w) => w.id === meta.workspaceId);
      workspacePath = entry?.path;
    } catch (err) {
      log.debug('idle workspacePath resolve failed', { err });
    }
  }
  const workspaceOverridePresent = await probeWorkspaceOverridePresent(workspacePath);
  return getInspectorSnapshot({
    conversationId,
    workspaceId: wsId,
    messages,
    rules,
    workspaceOverridePresent,
    modelId,
    ...(ceiling !== undefined ? { ceiling } : {})
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
      runId: string
    ): Promise<
      | { ok: true; summaryId: string }
      | { ok: false; reason: string }
    > => {
      const handle = getRunContext(runId);
      if (!handle) return { ok: false, reason: 'No active run for this id' };
      const result = await handle.triggerManual();
      if (result.ok) broadcastSnapshotChanged(runId);
      return result;
    }
  );

  // ── undo ──────────────────────────────────────────────────────────
  wrapIpcHandler(
    IPC.CONTEXT_SUMMARY_UNDO,
    async (
      _event,
      runId: string,
      summaryId: string
    ): Promise<{ ok: boolean }> => {
      const handle = getRunContext(runId);
      if (!handle) return { ok: false };
      const result = await handle.undo(summaryId);
      if (result.ok) broadcastSnapshotChanged(runId);
      return result;
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
      // Lazy import to avoid the registry's listing API forming a
      // circular through contextSummarizer/index.
      const { listActiveRunContexts } = await import(
        '../orchestrator/runContextRegistry.js'
      );
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
