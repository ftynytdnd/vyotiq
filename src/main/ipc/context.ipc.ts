/**
 * Context-window management IPC — manual "Compact now" and "Reset context"
 * controls. Both operate on the PERSISTED transcript (not a live run):
 * they replay the conversation, run the same reversible reduction tiers the
 * orchestrator uses, and append the resulting `tool-compacted` /
 * `context-summary` markers so the NEXT run replays from the lean context.
 * Events are mirrored to the renderer via the `manual:<conversationId>`
 * chat channel (same pattern as tool re-run).
 *
 * Guarded: refused while a run is active or paused for the conversation, so a
 * manual reduction can never race the orchestrator mutating the same JSONL.
 */

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { IPC } from '@shared/constants.js';
import type { TimelineEvent } from '@shared/types/chat.js';
import type {
  ContextArtifactReadInput,
  ContextArtifactReadReply,
  ContextEvaluateInput,
  ContextEvaluateReply,
  ContextManualInput,
  ContextManualReply
} from '@shared/types/ipc.js';
import { realpathInsideWorkspace } from '../tools/sandbox.js';
import { appendEvent, getConversationMeta, readConversation } from '../conversations/conversationStore.js';
import { requireWorkspaceById } from '../workspace/workspaceState.js';
import { getSettings } from '../settings/settingsStore.js';
import { resolveAgentBehaviorSettings } from '@shared/settings/agentBehaviorSettings.js';
import {
  findAllActiveRunsForConversation,
  findPausedRunForConversation
} from '../orchestrator/AgentV.js';
import { replayTranscript } from '../orchestrator/replay/replayTranscript.js';
import { seedCacheLayeredMessages } from '../orchestrator/context/buildContextLayers.js';
import { toolSchemasFor } from '../tools/registry.js';
import { AGENT_TOOLS } from '../tools/policy/index.js';
import {
  createContextReductionState,
  reduceContextIfNeeded,
  resetContextToSummary,
  type ReduceContextOpts
} from '../orchestrator/context/contextCompaction.js';
import { safeWebContentsSend } from '../window/safeWebContentsSend.js';
import { logger } from '../logging/logger.js';
import { wrapIpcHandler } from './wrapIpcHandler.js';
import { assertObject, assertString } from './validate.js';
import { evaluateConversationContext } from '../orchestrator/context/contextEvaluate.js';
import { loadContextCalibration } from '../orchestrator/context/contextCalibration.js';

const log = logger.child('ipc/context');

const MANUAL_PREFIX = 'manual:';

function assertContextManualInput(channel: string, input: ContextManualInput): void {
  assertObject(channel, 'input', input);
  assertString(channel, 'conversationId', input.conversationId);
  assertObject(channel, 'selection', input.selection);
  assertString(channel, 'selection.providerId', input.selection.providerId);
  assertString(channel, 'selection.modelId', input.selection.modelId);
}

type Mode = 'compact' | 'reset';

async function runManualReduction(
  channel: string,
  input: ContextManualInput,
  mode: Mode
): Promise<ContextManualReply> {
  assertContextManualInput(channel, input);
  const { conversationId } = input;

  const meta = await getConversationMeta(conversationId);
  if (!meta?.workspaceId) {
    return { ok: false, reason: 'unknown-conversation' };
  }

  // Never race a live or paused run mutating the same transcript.
  if (
    findAllActiveRunsForConversation(conversationId).length > 0 ||
    findPausedRunForConversation(conversationId) !== undefined
  ) {
    return { ok: false, reason: 'busy' };
  }

  let workspacePath: string;
  try {
    workspacePath = await requireWorkspaceById(meta.workspaceId);
  } catch (err) {
    return {
      ok: false,
      reason: 'failed',
      message: err instanceof Error ? err.message : String(err)
    };
  }

  const conv = await readConversation(conversationId);
  if (!conv) return { ok: false, reason: 'unknown-conversation' };

  const history = replayTranscript(conv.events);
  const seeded = seedCacheLayeredMessages(history, '');

  const settings = resolveAgentBehaviorSettings((await getSettings()).ui).contextManagement;
  const calibrationRatio = await loadContextCalibration(
    conversationId,
    input.selection.providerId,
    input.selection.modelId
  );
  const runId = `${MANUAL_PREFIX}${randomUUID()}`;
  let changed = false;
  let tokensRemoved = 0;

  const emit = (event: TimelineEvent): void => {
    if (event.kind === 'tool-compacted' || event.kind === 'context-summary') {
      changed = true;
      if (event.tokensRemoved && event.tokensRemoved > 0) {
        tokensRemoved += event.tokensRemoved;
      }
    }
    // All emitted kinds here (tool-compacted, context-summary, agent-thought)
    // are persistent; append to the transcript and mirror to the renderer.
    void appendEvent(conversationId, event).catch((err) =>
      log.warn('appendEvent failed during manual context op', {
        conversationId,
        kind: event.kind,
        err: err instanceof Error ? err.message : String(err)
      })
    );
    safeWebContentsSend(IPC.CHAT_EVENT, `${MANUAL_PREFIX}${conversationId}`, event);
  };

  const opts: ReduceContextOpts = {
    conversationId,
    runId,
    workspacePath,
    modelId: input.selection.modelId,
    providerId: input.selection.providerId,
    settings,
    // Mirror the live run's budget inputs: the agent's tool schemas occupy a
    // few thousand prompt tokens, so omitting them would make the manual
    // budget under-count and pick a slightly-off offload target.
    tools: toolSchemasFor(AGENT_TOOLS),
    ...(calibrationRatio !== undefined ? { calibrationRatio } : {}),
    emit
  };

  try {
    if (mode === 'compact') {
      const result = await reduceContextIfNeeded(
        seeded,
        { ...opts, force: true },
        createContextReductionState()
      );
      if (result.tokensRemoved && result.tokensRemoved > tokensRemoved) {
        tokensRemoved = result.tokensRemoved;
      }
    } else {
      await resetContextToSummary(seeded, opts, createContextReductionState());
    }
  } catch (err) {
    log.warn('manual context reduction failed', {
      conversationId,
      mode,
      err: err instanceof Error ? err.message : String(err)
    });
    return {
      ok: false,
      reason: 'failed',
      message: err instanceof Error ? err.message : String(err)
    };
  }

  log.info('manual context reduction done', { conversationId, mode, changed, tokensRemoved });
  return {
    ok: true,
    changed,
    ...(tokensRemoved > 0 ? { tokensRemoved } : {})
  };
}

/** Upper bound on artifact content returned to the renderer (memory safety). */
const MAX_ARTIFACT_READ_CHARS = 2_000_000;

async function readContextArtifact(
  channel: string,
  input: ContextArtifactReadInput
): Promise<ContextArtifactReadReply> {
  assertObject(channel, 'input', input);
  assertString(channel, 'conversationId', input.conversationId);
  assertString(channel, 'relativePath', input.relativePath);

  const meta = await getConversationMeta(input.conversationId);
  if (!meta?.workspaceId) return { ok: false, reason: 'unknown-conversation' };

  let workspacePath: string;
  try {
    workspacePath = await requireWorkspaceById(meta.workspaceId);
  } catch (err) {
    return { ok: false, reason: 'failed', message: err instanceof Error ? err.message : String(err) };
  }

  let abs: string;
  try {
    // Route through the workspace sandbox so a crafted relativePath can never
    // escape the workspace and read arbitrary files off disk.
    abs = await realpathInsideWorkspace(workspacePath, input.relativePath);
  } catch (err) {
    return { ok: false, reason: 'not-found', message: err instanceof Error ? err.message : String(err) };
  }

  try {
    const raw = await readFile(abs, 'utf8');
    const content =
      raw.length > MAX_ARTIFACT_READ_CHARS
        ? `${raw.slice(0, MAX_ARTIFACT_READ_CHARS)}\n\n… (truncated — full artifact is ${raw.length} chars)`
        : raw;
    return { ok: true, content };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') return { ok: false, reason: 'not-found' };
    return { ok: false, reason: 'failed', message: err instanceof Error ? err.message : String(err) };
  }
}

async function evaluateContext(
  channel: string,
  input: ContextEvaluateInput
): Promise<ContextEvaluateReply> {
  assertObject(channel, 'input', input);
  assertString(channel, 'workspaceId', input.workspaceId);
  assertObject(channel, 'selection', input.selection);
  assertString(channel, 'selection.providerId', input.selection.providerId);
  assertString(channel, 'selection.modelId', input.selection.modelId);
  if (input.conversationId !== undefined) {
    assertString(channel, 'conversationId', input.conversationId);
  }

  try {
    await requireWorkspaceById(input.workspaceId);
  } catch (err) {
    return {
      ok: false,
      reason: 'no-workspace',
      message: err instanceof Error ? err.message : String(err)
    };
  }

  const settings = resolveAgentBehaviorSettings((await getSettings()).ui).contextManagement;
  try {
    const calibrationRatio = await loadContextCalibration(
      input.conversationId,
      input.selection.providerId,
      input.selection.modelId
    );
    const usage = await evaluateConversationContext({
      ...(input.conversationId !== undefined ? { conversationId: input.conversationId } : {}),
      workspaceId: input.workspaceId,
      modelId: input.selection.modelId,
      providerId: input.selection.providerId,
      settings,
      ...(input.draftPrompt !== undefined ? { draftPrompt: input.draftPrompt } : {}),
      ...(input.draftAttachmentMeta !== undefined
        ? { draftAttachmentMeta: input.draftAttachmentMeta }
        : {}),
      ...(calibrationRatio !== undefined ? { calibrationRatio } : {})
    });
    return { ok: true, usage };
  } catch (err) {
    log.warn('context evaluate failed', {
      err: err instanceof Error ? err.message : String(err)
    });
    return {
      ok: false,
      reason: 'failed',
      message: err instanceof Error ? err.message : String(err)
    };
  }
}

export function registerContextIpc(): void {
  wrapIpcHandler(IPC.CONTEXT_COMPACT_NOW, (_e, input: ContextManualInput) =>
    runManualReduction('context:compact-now', input, 'compact')
  );
  wrapIpcHandler(IPC.CONTEXT_RESET, (_e, input: ContextManualInput) =>
    runManualReduction('context:reset', input, 'reset')
  );
  wrapIpcHandler(IPC.CONTEXT_READ_ARTIFACT, (_e, input: ContextArtifactReadInput) =>
    readContextArtifact('context:read-artifact', input)
  );
  wrapIpcHandler(IPC.CONTEXT_EVALUATE, (_e, input: ContextEvaluateInput) =>
    evaluateContext('context:evaluate', input)
  );
}
