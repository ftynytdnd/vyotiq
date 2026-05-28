/**
 * Renderer-initiated tool re-run — executes a settled tool outside an
 * orchestrator turn, persists tool-call/result to the JSONL transcript,
 * and mirrors events through the `manual:<conversationId>` chat channel.
 */

import { randomUUID } from 'node:crypto';
import { IPC } from '@shared/constants.js';
import type { TimelineEvent } from '@shared/types/chat.js';
import type { ToolResult } from '@shared/types/tool.js';
import type { ToolRerunInput, ToolRerunReply } from '@shared/types/ipc.js';
import { isRerunnableToolInput } from '@shared/tools/toolRerun.js';
import { appendEvent, getConversationMeta } from '../conversations/conversationStore.js';
import { runToolByName } from '../orchestrator/toolRunner.js';
import { requireWorkspaceById } from '../workspace/workspaceState.js';
import { getSettings, resolvePermissionsForWorkspace } from '../settings/settingsStore.js';
import { safeWebContentsSend } from '../window/safeWebContentsSend.js';
import { logger } from '../logging/logger.js';

const log = logger.child('ipc/toolRerun');

const MANUAL_PREFIX = 'manual:';

function mirrorToRenderer(conversationId: string, event: TimelineEvent): void {
  safeWebContentsSend(IPC.CHAT_EVENT, `${MANUAL_PREFIX}${conversationId}`, event);
}

function persistAndMirror(conversationId: string, event: TimelineEvent): void {
  appendEvent(conversationId, event).catch((err) =>
    log.warn('appendEvent failed during tool rerun', { conversationId, kind: event.kind, err })
  );
  mirrorToRenderer(conversationId, event);
}

export async function executeToolRerun(input: ToolRerunInput): Promise<ToolRerunReply> {
  if (!isRerunnableToolInput(input.toolName, input.args)) {
    return { ok: false, reason: 'tool-not-rerunnable' };
  }

  const meta = await getConversationMeta(input.conversationId);
  if (!meta?.workspaceId) {
    return { ok: false, reason: 'unknown-conversation' };
  }

  const workspacePath = await requireWorkspaceById(meta.workspaceId);
  const settings = await getSettings();
  const permissions = resolvePermissionsForWorkspace(settings, meta.workspaceId);
  const strictApprovals =
    settings.ui?.strictApprovalsByWorkspace?.[meta.workspaceId] === true;

  const callId = randomUUID();
  const startedAt = Date.now();

  const toolCallEvent: TimelineEvent = {
    kind: 'tool-call',
    id: randomUUID(),
    ts: startedAt,
    call: {
      id: callId,
      name: input.toolName,
      args: input.args
    }
  };
  persistAndMirror(input.conversationId, toolCallEvent);

  const abort = new AbortController();
  let result: ToolResult;
  try {
    result = await runToolByName(input.toolName, input.args, {
      workspacePath,
      workspaceId: meta.workspaceId,
      runId: `rerun:${callId}`,
      conversationId: input.conversationId,
      permissions,
      strictApprovals,
      emit: (event) => persistAndMirror(input.conversationId, event),
      signal: abort.signal
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn('tool rerun threw', { toolName: input.toolName, message });
    return { ok: false, reason: 'execution-failed', message };
  }

  result.id = callId;

  const toolResultEvent: TimelineEvent = {
    kind: 'tool-result',
    id: randomUUID(),
    ts: Date.now(),
    result
  };
  persistAndMirror(input.conversationId, toolResultEvent);

  return { ok: true, callId };
}
