/**
 * AgentV — public orchestrator surface.
 *
 * Intentionally thin: lifecycle (start/abort), workspace check, run-id
 * tracking. The actual loop body lives in `./loop/runLoop.ts`. The harness
 * markdown drives the cognitive behavior; this file just connects the
 * lifecycle wiring.
 */

import { randomUUID } from 'node:crypto';
import type {
  ChatSendInput,
  ChatMessage,
  TimelineEvent
} from '@shared/types/chat.js';
import type { ActiveRunInfo } from '@shared/types/ipc.js';
import type { AskUserSubmitInput } from '@shared/types/askUser.js';
import { IPC } from '@shared/constants.js';
import { formatAskUserDisplayFromAnswers, formatAskUserToolResult } from '@shared/text/formatAskUserAnswers.js';
import { safeWebContentsSend } from '../window/safeWebContentsSend.js';
import { wrapXml } from './envelope/index.js';
import { resolveAttachmentsForInline } from '../attachments/resolveAttachmentsForInline.js';
import { replayTranscript } from './replay/index.js';
import { runOrchestratorLoop } from './loop/index.js';
import {
  requireWorkspace,
  requireWorkspaceById
} from '../workspace/workspaceState.js';
import {
  setActiveConversationForRun,
  setActiveWorkspaceForRun
} from '../tools/recall.tool.js';
import { openRun as openCheckpointRun, finalizeRun as finalizeCheckpointRun } from '../checkpoints/index.js';
import { logger } from '../logging/logger.js';
import {
  clearPausedRun,
  findPausedRunForConversation,
  getPausedRun,
  isRunAwaitingUser,
  storePausedRun,
  takePausedRun,
  type LoopCheckpoint
} from './pausedRunRegistry.js';
import { registerRunCrashDrain } from './runCrashDrain.js';

const log = logger.child('orchestrator/AgentV');

export { findPausedRunForConversation };

export interface AgentVDeps {
  emit: (event: TimelineEvent) => void;
  onDone: () => void;
  onError: (message: string) => void;
  /** Called when the run pauses on `ask_user` (same runId stays live). */
  onAwaitingUser?: () => void;
}

interface ActiveRun {
  /** Monotonic per `runId` — `finally` only deletes when generation matches. */
  generation: number;
  abort: AbortController;
  /**
   * The conversation this run is writing events into. Tracked so we can
   * detect / abort a concurrent run against the same transcript — see
   * `hasActiveRunForConversation`. Optional because fresh runs bind the
   * conversation id lazily (the chat IPC resolves `input.conversationId`
   * before calling `startRun`).
   */
  conversationId: string | undefined;
  /**
   * The workspace this run is pinned to. Captured at `startRun` time so
   * the renderer's `chat.listActiveRuns()` rehydration can repopulate
   * the per-workspace running indicators without an extra lookup, and
   * so the workspace-remove cascade can identify runs to abort by
   * pinned workspace rather than by conversation id alone.
   */
  workspaceId: string | undefined;
  /**
   * The provider this run is talking to. Captured at startRun so a
   * `removeProvider` IPC can abort every in-flight run that depends
   * on the deleted provider record (Audit fix L-07) instead of
   * letting subsequent iterations fail at `getProviderWithKey`
   * lookup and surface as confusing provider errors.
   */
  providerId: string;
  /** Model id selected for this run (composer model picker). */
  modelId: string;
  /** Wall-clock ms when the run was registered. */
  startedAt: number;
  /** True while latched on interactive `ask_user` (still in activeRuns). */
  awaitingUser?: boolean;
}

const activeRuns = new Map<string, ActiveRun>();

/** Abort every in-flight run and notify the renderer with a shared error. */
function abortAllActiveRunsWithError(message: string): void {
  for (const info of listActiveRuns()) {
    abortRun(info.runId);
    safeWebContentsSend(IPC.CHAT_ERROR, info.runId, message);
  }
}

export function abortRun(runId: string): void {
  const run = activeRuns.get(runId);
  if (!run) return;
  run.abort.abort();
  clearPausedRun(runId);
  // Keep the registry entry until `startRun`'s `finally` drops it.
  // Deleting here made `listActiveRuns` / rehydrate miss in-flight
  // runs that were still winding down, so late events were routed
  // to the wrong slice or dropped entirely.
}

/**
 * Returns every active run id bound to the given `conversationId`.
 * Used by `chat.ipc.ts` to fail-fast when a second `chat:send` lands
 * for a conversation whose previous run is still streaming — otherwise
 * two orchestrator loops would interleave tool calls and sub-agent
 * traces into the same JSONL transcript.
 *
 * The supersede contract guarantees there's normally at most ONE entry
 * per conversation, but this returns an array so an unforeseen race or
 * future bug that leaks two doesn't leave one silently streaming after
 * the supersede path "thought" it had aborted everything. Callers
 * iterate and abort all; the count is logged when > 1 so the
 * regression surfaces loudly.
 */
export function findAllActiveRunsForConversation(
  conversationId: string
): string[] {
  const out: string[] = [];
  for (const [runId, run] of activeRuns) {
    if (run.conversationId === conversationId) out.push(runId);
  }
  return out;
}

/**
 * Snapshot of every orchestrator run currently in flight. One row per
 * entry in the in-memory `activeRuns` map. Returned by the
 * `chat.listActiveRuns()` IPC so the renderer can rehydrate its
 * `runId → conversation` dispatch table after a renderer reload
 * (HMR / F5). Without this, sibling-workspace runs keep streaming
 * events with `runId`s the renderer no longer recognises and they're
 * silently dropped by `applyEvent`.
 *
 * Cheap O(N) iteration over a Map that's typically ≤ a handful of
 * entries — no caching needed.
 */
export function listActiveRuns(): ActiveRunInfo[] {
  const out: ActiveRunInfo[] = [];
  for (const [runId, run] of activeRuns) {
    out.push({
      runId,
      ...(run.conversationId ? { conversationId: run.conversationId } : {}),
      ...(run.workspaceId ? { workspaceId: run.workspaceId } : {}),
      modelId: run.modelId,
      startedAt: run.startedAt,
      ...(run.awaitingUser ? { awaitingUser: true } : {})
    });
  }
  return out;
}

/**
 * Aborts every in-flight run pinned to the given `conversationId`.
 * Returns the count of runs that were signalled. Used by
 * `removeConversation` so deleting a conversation mid-run does not
 * leave the orchestrator burning tokens into a tombstoned transcript.
 */
export function abortRunsForConversation(conversationId: string): number {
  let aborted = 0;
  // Route through `abortRun` (not a bare `run.abort.abort()`) so a run
  // paused on `ask_user` also has its `pausedRuns` checkpoint cleared.
  // A paused run's loop is NOT executing, so aborting the signal alone
  // does nothing — the heavy `LoopCheckpoint` (messages, spin buffer,
  // IPC callbacks) would otherwise leak for the rest of the session
  // when the conversation/workspace/provider it belongs to is removed.
  for (const [runId, run] of activeRuns) {
    if (run.conversationId === conversationId) {
      abortRun(runId);
      aborted += 1;
    }
  }
  return aborted;
}

/**
 * Aborts every in-flight run pinned to the given `workspaceId`. Used
 * by the workspace-remove cascade (`bulkRemoveOrReparentByWorkspace`)
 * when the user chose to delete (not reparent) every conversation
 * under a workspace — the orchestrator loops should stop too.
 */
export function abortRunsForWorkspace(workspaceId: string): number {
  let aborted = 0;
  for (const [runId, run] of activeRuns) {
    if (run.workspaceId === workspaceId) {
      abortRun(runId);
      aborted += 1;
    }
  }
  return aborted;
}

/**
 * Aborts every in-flight run pinned to the given `providerId`. Used by
 * `removeProvider` so deleting a provider mid-run stops the orchestrator
 * loops that depend on the deleted provider record immediately, instead
 * of letting subsequent iterations surface as confusing provider errors
 * when `getProviderWithKey` returns null. Audit fix L-07.
 */
export function abortRunsForProvider(providerId: string): number {
  let aborted = 0;
  for (const [runId, run] of activeRuns) {
    if (run.providerId === providerId) {
      abortRun(runId);
      aborted += 1;
    }
  }
  return aborted;
}

/**
 * Starts a new orchestration run.
 *
 * @param input            The send request (prompt, model selection,
 *                         permissions, attachments).
 * @param deps             Event emitter + lifecycle callbacks.
 * @param priorTranscript  Optional persisted timeline events from earlier
 *                         turns of this conversation. Replayed into the
 *                         model's `messages` so the agent has memory.
 */
function removeActiveRunIfCurrent(runId: string, generation: number): void {
  const entry = activeRuns.get(runId);
  if (entry?.generation === generation) activeRuns.delete(runId);
}

export async function startRun(
  input: ChatSendInput,
  deps: AgentVDeps,
  priorTranscript?: TimelineEvent[]
): Promise<void> {
  const abort = new AbortController();
  const prior = activeRuns.get(input.runId);
  if (prior) {
    prior.abort.abort();
  }
  const generation = (prior?.generation ?? 0) + 1;
  activeRuns.set(input.runId, {
    generation,
    abort,
    conversationId: input.conversationId,
    workspaceId: input.workspaceId,
    providerId: input.selection.providerId,
    modelId: input.selection.modelId,
    startedAt: Date.now()
  });

  const emit = deps.emit;

  // Mint the prompt id up-front so we can both emit it and pass it
  // down to `buildInitialMessages` for precise replay-deduplication
  // (filter by id, not by content — see §3.6 in the audit).
  const promptEventId = input.promptEventId ?? randomUUID();
  emit({
    kind: 'user-prompt',
    id: promptEventId,
    ts: Date.now(),
    content: input.prompt,
    attachments:
      input.attachmentMeta && input.attachmentMeta.length > 0
        ? input.attachmentMeta
        : undefined,
    // Pin the prompt to its run so the inline per-prompt Revert
    // affordance (and the `rewindToPrompt` IPC) can resolve the
    // matching checkpoint manifest in O(1). Older transcripts that
    // lack this field fall back to a `manifest.startedAt ≈ event.ts`
    // heuristic — see `resolveRunIdForPrompt` in
    // `src/main/checkpoints/rewindToPrompt.ts`.
    runId: input.runId
  });

  let workspacePath: string;
  try {
    // Pin the workspace by id when the chat IPC has resolved one (the
    // common path post-multi-workspace). Falling back to
    // `requireWorkspace()` keeps the legacy single-active behaviour for
    // any caller that didn't supply a workspaceId — the global active
    // workspace acts as the implicit default.
    workspacePath = input.workspaceId
      ? await requireWorkspaceById(input.workspaceId)
      : await requireWorkspace();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    emit({ kind: 'error', id: randomUUID(), ts: Date.now(), message: msg });
    deps.onError(msg);
    removeActiveRunIfCurrent(input.runId, generation);
    return;
  }

  // Register the active conversation id against this run's signal so the
  // `recall` tool can short-circuit a self-recall (the orchestrator's
  // own transcript is already replayed into `messages`; recalling it
  // would just duplicate context). Keyed by `abort.signal` via the
  // same WeakMap pattern `toolResultCache` uses, so the entry is GC'd
  // with the run automatically. Skipped when no conversationId is bound
  // (transient pre-binding window) — the tool falls back to the
  // pre-existing "self-recall is implicit" guidance in its brief.
  if (input.conversationId) {
    setActiveConversationForRun(abort.signal, input.conversationId);
  }
  // Same WeakMap pattern, but for the run's pinned workspace id —
  // `recall list` / `recall read` consult it to scope cross-conversation
  // access to the same workspace. Without this, a run in workspace A
  // could pull transcript bodies from workspace B, breaking the
  // workspace boundary contract.
  if (input.workspaceId) {
    setActiveWorkspaceForRun(abort.signal, input.workspaceId);
  }

  let resolvedWorkspaceId = input.workspaceId ?? '';

  // Open the run's checkpoint manifest BEFORE the loop body so any
  // tool that mutates files in iteration 0 already has somewhere to
  // append. Best-effort: a checkpoint-store failure must NEVER fail
  // the whole run (the orchestrator's primary contract is still
  // "answer the user"). If the open fails, tools simply degrade to
  // an empty manifest until edits are recorded again.
  if (resolvedWorkspaceId && input.conversationId) {
    try {
      await openCheckpointRun({
        runId: input.runId,
        conversationId: input.conversationId,
        workspaceId: resolvedWorkspaceId,
        label: input.prompt.split('\n')[0]?.slice(0, 120) || 'Run',
        startedAt: Date.now()
      });
    } catch (err) {
      log.warn('checkpoint openRun failed; tools will auto-recover', {
        runId: input.runId,
        err
      });
    }
  }

  try {
    const initialMessages = await buildInitialMessages(
      input,
      workspacePath,
      priorTranscript,
      promptEventId,
      // Audit fix 2026-08-P2-1 / 13-P2-1 — pipe the run's abort
      // signal into the prompt-assembly phase so an aborted run
      // stops paying FS cost during the `inlineFiles` step.
      abort.signal
    );
    // Surface the replay shape for triage. A non-fresh conversation MUST
    // produce `priorEventCount > 0` AND `replayedMessageCount > 0`; a
    // zero on either when the conversation has prior turns is the
    // smoking gun for the "agent has no memory" race we hardened
    // against in `readTranscript` + `drainAppendChain`. The subtraction
    // accounts for the system placeholder + the just-built user
    // envelope so the count reflects ONLY messages reconstructed from
    // history.
    log.info('orchestrator run start', {
      runId: input.runId,
      conversationId: input.conversationId,
      providerId: input.selection.providerId,
      modelId: input.selection.modelId,
      priorEventCount: priorTranscript?.length ?? 0,
      replayedMessageCount: Math.max(0, initialMessages.length - 2)
    });
    await runLoopBody({
      input,
      workspacePath,
      workspaceId: resolvedWorkspaceId,
      abort,
      generation,
      emit,
      deps,
      initialMessages,
      initialQuery: input.prompt,
      permissions: input.permissions
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    emit({ kind: 'error', id: randomUUID(), ts: Date.now(), message: msg });
    deps.onError(msg);
  } finally {
    const stillPaused = isRunAwaitingUser(input.runId);
    if (!stillPaused) {
      removeActiveRunIfCurrent(input.runId, generation);
      if (resolvedWorkspaceId && input.conversationId) {
        try {
          await finalizeCheckpointRun(input.runId);
        } catch (err) {
          log.warn('checkpoint finalizeRun failed', { runId: input.runId, err });
        }
      }
    }
  }
}

interface RunLoopBodyOpts {
  input: ChatSendInput;
  workspacePath: string;
  workspaceId: string;
  abort: AbortController;
  generation: number;
  emit: (event: TimelineEvent) => void;
  deps: AgentVDeps;
  initialMessages: ChatMessage[];
  initialQuery: string;
  permissions: ChatSendInput['permissions'];
  resumeCheckpoint?: LoopCheckpoint;
}

async function runLoopBody(opts: RunLoopBodyOpts): Promise<void> {
  const loopResult = await runOrchestratorLoop({
    input: opts.input,
    workspacePath: opts.workspacePath,
    workspaceId: opts.workspaceId,
    signal: opts.abort.signal,
    emit: opts.emit,
    initialMessages: opts.initialMessages,
    initialQuery: opts.initialQuery,
    permissions: opts.permissions,
    ...(opts.resumeCheckpoint ? { resumeCheckpoint: opts.resumeCheckpoint } : {})
  });

  if (loopResult.pausedForAskUser) {
    const run = activeRuns.get(opts.input.runId);
    if (run) run.awaitingUser = true;
    storePausedRun(opts.input.runId, {
      generation: opts.generation,
      input: opts.input,
      workspacePath: opts.workspacePath,
      workspaceId: opts.workspaceId,
      checkpoint: loopResult.pausedForAskUser,
      callbacks: {
        emit: opts.emit,
        onDone: opts.deps.onDone,
        onError: opts.deps.onError,
        onAwaitingUser: opts.deps.onAwaitingUser
      }
    });
    opts.deps.onAwaitingUser?.();
    return;
  }

  if (loopResult.terminalError) {
    opts.deps.onError(loopResult.terminalError);
  } else {
    opts.deps.onDone();
  }
}

/**
 * Resume a run paused on `ask_user` with the user's structured answers.
 */
export async function submitAskUserAnswers(input: AskUserSubmitInput): Promise<boolean> {
  const entry = getPausedRun(input.runId);
  if (!entry) {
    log.warn('submitAskUserAnswers: run not paused', { runId: input.runId });
    return false;
  }
  if (entry.input.conversationId !== input.conversationId) {
    log.warn('submitAskUserAnswers: conversation mismatch', {
      runId: input.runId,
      expected: entry.input.conversationId,
      got: input.conversationId
    });
    return false;
  }
  if (input.toolCallId !== entry.checkpoint.askUserToolCallId) {
    log.warn('submitAskUserAnswers: toolCallId mismatch', {
      runId: input.runId,
      expected: entry.checkpoint.askUserToolCallId,
      got: input.toolCallId
    });
    return false;
  }

  const run = activeRuns.get(input.runId);
  if (!run || run.generation !== entry.generation) {
    log.warn('submitAskUserAnswers: active run generation mismatch', { runId: input.runId });
    return false;
  }

  takePausedRun(input.runId);
  run.awaitingUser = false;

  const displayText = formatAskUserDisplayFromAnswers(
    input.payload,
    input.answers,
    input.supplementText
  );
  const toolContent = formatAskUserToolResult(
    input.payload,
    input.answers,
    input.supplementText
  );

  const { emit, onDone, onError, onAwaitingUser } = entry.callbacks;
  const ts = Date.now();
  const userPromptId = randomUUID();

  emit({
    kind: 'ask-user-submitted',
    id: randomUUID(),
    ts,
    promptEventId: input.promptEventId,
    toolCallId: input.toolCallId,
    runId: input.runId
  });
  if (displayText.length > 0) {
    emit({
      kind: 'user-prompt',
      id: userPromptId,
      ts,
      content: displayText,
      runId: input.runId
    });
  }
  emit({
    kind: 'tool-result',
    id: randomUUID(),
    ts,
    result: {
      id: input.toolCallId,
      name: 'ask_user',
      ok: true,
      output: toolContent,
      durationMs: 0
    }
  });

  const messages = entry.checkpoint.messages;
  messages.push({
    role: 'tool',
    tool_call_id: input.toolCallId,
    name: 'ask_user',
    content: toolContent
  });

  try {
    await runLoopBody({
      input: entry.input,
      workspacePath: entry.workspacePath,
      workspaceId: entry.workspaceId,
      abort: run.abort,
      generation: entry.generation,
      emit,
      deps: { emit, onDone, onError, onAwaitingUser },
      initialMessages: messages,
      initialQuery: entry.checkpoint.query,
      permissions: entry.input.permissions,
      resumeCheckpoint: entry.checkpoint
    });
  } catch (err: unknown) {
    clearPausedRun(input.runId);
    const msg = err instanceof Error ? err.message : String(err);
    emit({ kind: 'error', id: randomUUID(), ts: Date.now(), message: msg });
    onError(msg);
    removeActiveRunIfCurrent(input.runId, entry.generation);
    return false;
  }

  if (!isRunAwaitingUser(input.runId)) {
    removeActiveRunIfCurrent(input.runId, entry.generation);
    if (entry.workspaceId && entry.input.conversationId) {
      try {
        await finalizeCheckpointRun(input.runId);
      } catch (err) {
        log.warn('checkpoint finalizeRun failed after ask_user resume', {
          runId: input.runId,
          err
        });
      }
    }
  }
  return true;
}

/**
 * Composes the messages array seeded for the loop:
 *   - empty system slot (filled per-iteration by `runOrchestratorLoop`)
 *   - replayed prior transcript (so the agent remembers past turns)
 *   - the new user envelope (with safely-escaped user content + attachments)
 *
 * The system message is left as a placeholder so the loop can swap in a
 * freshly-built prompt on each iteration without rebuilding the rest.
 */
async function buildInitialMessages(
  input: ChatSendInput,
  workspacePath: string,
  priorTranscript?: TimelineEvent[],
  /**
   * Id of the `user-prompt` event the chat IPC just emitted for this
   * run. Used to drop EXACTLY that one entry from the replay so the
   * current prompt isn't double-counted, without dropping prior
   * identical prompts (e.g. the user typing `"yes"` twice).
   */
  currentPromptId?: string,
  /**
   * Audit fix 2026-08-P2-1 / 13-P2-1: optional run-scoped abort signal.
   * Threaded into `inlineFiles` below so a user who aborts a long
   * `chat:send` (50-file delegate spec, 5 MB attached log) stops paying
   * FS cost mid-prompt-assembly. Optional so direct callers / tests
   * keep the legacy four-arg shape.
   */
  signal?: AbortSignal
): Promise<ChatMessage[]> {
  const source = priorTranscript ?? [];
  const replayEvents: TimelineEvent[] = [];
  for (const e of source) {
    // Drop the just-emitted user-prompt event for the current run by
    // id. Filtering by content (the prior behavior) was unsafe — two
    // identical prompts would BOTH be dropped from history.
    if (e.kind === 'user-prompt') {
      const isCurrent = currentPromptId
        ? e.id === currentPromptId
        : e.content === input.prompt;
      if (!isCurrent) replayEvents.push(e);
    } else {
      replayEvents.push(e);
    }
  }
  const replayed = replayTranscript(replayEvents);

  const userMessageXml = wrapXml('user_message', input.prompt, undefined, { escape: true });
  const attachmentBlocks = await resolveAttachmentsForInline({
    attachmentMeta: input.attachmentMeta,
    legacyAttachments: input.attachments,
    workspacePath,
    signal
  });
  const attachmentsXml =
    attachmentBlocks.length > 0
      ? wrapXml('attached_files', attachmentBlocks, undefined, { escape: true })
      : '';
  const turnBody = attachmentsXml ? `${userMessageXml}\n${attachmentsXml}` : userMessageXml;
  const userEnvelope = wrapXml('turn', turnBody);

  return [
    { role: 'system', content: '' }, // filled per-iteration
    ...replayed,
    { role: 'user', content: userEnvelope }
  ];
}

// `ChatPermissions` is intentionally NOT re-exported here. Layering rule:
// orchestrator modules consume shared types but should not bridge them
// for the renderer — external callers import directly from
// `@shared/types/chat`.

registerRunCrashDrain(abortAllActiveRunsWithError);
