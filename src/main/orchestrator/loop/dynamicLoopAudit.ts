/**
 * Host verify-before-finish net. The dynamic loop is model-directed: the
 * harness tells Agent V to self-audit and `continue` after substantive work.
 * The host no longer injects a per-iteration audit nudge — it only injects a
 * single verification prompt at the deferred-finish boundary (finish co-emitted
 * with substantive edits), so a run cannot settle on unverified changes without
 * at least one explicit "re-check, then finish" pass.
 */

import { randomUUID } from 'node:crypto';
import type { ModelSelection } from '@shared/types/provider.js';
import { normalizeRegisteredToolName } from '@shared/tools/normalizeToolName.js';
import type { PartialToolCall } from './handleAssistantTurn.js';
import { tryParseArgumentsRecord } from './parseToolArgs.js';
import {
  injectFollowUp,
  type InjectFollowUpResult
} from '../followUps/injectFollowUp.js';
import type { FollowUpLoopCtx, FollowUpInjectResult } from '../followUps/followUpLoopHooks.js';

export const DEFAULT_DYNAMIC_LOOP_CONTINUE_PROMPT = `<dynamic_loop_continue>
Continue this task in the same run. Audit your recent work if you have not already, then take the next step toward the goal. Do not call finish until this segment is verified.
</dynamic_loop_continue>`;

export const DEFAULT_DYNAMIC_LOOP_AUDIT_PROMPT = `<dynamic_loop_audit>
You called finish right after substantive edits. Verify before this run settles:
1. Re-read the files you changed and run the relevant tests or build.
2. If anything is incomplete or unverified, fix it in-loop and do not finish yet —
   use continue with a specific next step.
3. Finish only once the work is verified against the user's goal and <goal_anchor>.
</dynamic_loop_audit>`;

const SUBSTANTIVE_TOOL_NAMES = new Set(['edit', 'delete']);

const BASH_VERIFY_PATTERN =
  /\b(pnpm|npm|yarn|bun)\s+(test|run\s+test|build|vitest)|\b(vitest|pytest|cargo\s+test|go\s+test)\b/i;

function normalizedToolName(tc: PartialToolCall): string | null {
  if (!tc.name) return null;
  return normalizeRegisteredToolName(tc.name) ?? tc.name;
}

function isSubstantiveToolCall(tc: PartialToolCall): boolean {
  const name = normalizedToolName(tc);
  if (name === null) return false;
  if (SUBSTANTIVE_TOOL_NAMES.has(name)) return true;
  if (name !== 'bash') return false;
  const args = tryParseArgumentsRecord(tc.argumentsBuf);
  const command = typeof args?.command === 'string' ? args.command : '';
  return BASH_VERIFY_PATTERN.test(command);
}

export function clearsDynamicLoopAuditAwaiting(actionTools: PartialToolCall[]): boolean {
  return actionTools.some((tc) => {
    const name = normalizedToolName(tc);
    if (name === 'continue') return true;
    if (name !== null && SUBSTANTIVE_TOOL_NAMES.has(name)) return true;
    return isSubstantiveToolCall(tc);
  });
}

export function shouldInjectDynamicLoopAudit(
  actionTools: PartialToolCall[],
  finishedToolCalls: PartialToolCall[],
  auditAwaitingResponse: boolean
): boolean {
  if (auditAwaitingResponse) return false;
  if (actionTools.some((tc) => normalizedToolName(tc) === 'continue')) {
    return false;
  }
  const hasSubstantive = actionTools.some((tc) => isSubstantiveToolCall(tc));
  if (!hasSubstantive) return false;

  const hasAskUser = finishedToolCalls.some((tc) => normalizedToolName(tc) === 'ask_user');
  if (hasAskUser) return false;

  // Finish-only turns should settle; finish co-emitted with substantive tools is deferred.
  const hasFinish = finishedToolCalls.some((tc) => normalizedToolName(tc) === 'finish');
  const finishOnly = hasFinish && !hasSubstantive;
  return !finishOnly;
}

export async function injectDynamicLoopAudit(
  ctx: FollowUpLoopCtx,
  selection: ModelSelection
): Promise<FollowUpInjectResult | undefined> {
  if (!ctx.conversationId) return undefined;

  const injected: InjectFollowUpResult = await injectFollowUp({
    followUp: {
      id: randomUUID(),
      kind: 'steering',
      prompt: DEFAULT_DYNAMIC_LOOP_AUDIT_PROMPT,
      selection: { ...selection },
      queuedAt: Date.now(),
      source: 'dynamic-loop'
    },
    runId: ctx.runId,
    conversationId: ctx.conversationId,
    workspacePath: ctx.workspacePath,
    workspaceId: ctx.workspaceId,
    emit: ctx.emit,
    messages: ctx.messages,
    signal: ctx.signal
  });

  return { query: injected.query, selection: { ...selection } };
}
