/**
 * Host verify-before-finish net. The dynamic loop is model-directed: the
 * harness tells Agent V to self-audit and `continue` after substantive work.
 * The host no longer injects a per-iteration audit nudge — it only injects a
 * single verification prompt at the deferred-finish boundary (finish co-emitted
 * with substantive edits), so a run cannot settle on unverified changes without
 * at least one explicit "re-check, then finish" pass.
 */

import { randomUUID } from 'node:crypto';
import type { ChatMessage } from '@shared/types/chat.js';
import type { ModelSelection } from '@shared/types/provider.js';
import { normalizeRegisteredToolName } from '@shared/tools/normalizeToolName.js';
import type { PartialToolCall } from './handleAssistantTurn.js';
import { tryParseArgumentsRecord } from './parseToolArgs.js';
import {
  injectFollowUp,
  type InjectFollowUpResult
} from '../followUps/injectFollowUp.js';
import type { FollowUpLoopCtx, FollowUpInjectResult } from '../followUps/followUpLoopHooks.js';
import { isCacheLayeredTopology } from '../context/buildContextLayers.js';

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

export const ENHANCED_DYNAMIC_LOOP_AUDIT_PROMPT = `<dynamic_loop_audit>
You called finish after multiple substantive edits without running tests or a build.
Verify before this run settles:
1. Re-read every file you changed and run the relevant tests or build.
2. Load the \`review-checklist\` skill via \`context\` and walk its rubric.
3. If anything is incomplete or unverified, fix it in-loop — use continue with a
   specific next step; do not finish yet.
4. Finish only once the work is verified against the user's goal and <goal_anchor>.
</dynamic_loop_audit>`;

/** Minimum substantive edits in run history before the unverified-finish net fires. */
export const MIN_EDITS_BEFORE_UNVERIFIED_AUDIT = 2;

/** Maximum verify-before-finish audit injections per run. */
export const MAX_DYNAMIC_LOOP_AUDIT_INJECTIONS = 2;

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

function isVerifyBashToolName(name: string, argumentsJson: string): boolean {
  if (name !== 'bash') return false;
  const args = tryParseArgumentsRecord(argumentsJson);
  const command = typeof args?.command === 'string' ? args.command : '';
  return BASH_VERIFY_PATTERN.test(command);
}

/** Slice assistant/tool history for the current run (excludes replayed prior runs). */
export function sliceRunScopedMessages(
  runMessages: readonly ChatMessage[],
  runHistoryStartIndex = 0
): readonly ChatMessage[] {
  if (runHistoryStartIndex <= 0) return runMessages;
  const end = isCacheLayeredTopology(runMessages) ? runMessages.length - 2 : runMessages.length;
  return runMessages.slice(runHistoryStartIndex, end);
}

/** True when the run has 2+ edits/deletes and no test/build bash in history. */
export function runHasUnverifiedSubstantiveEdits(
  runMessages: readonly ChatMessage[],
  runHistoryStartIndex = 0
): boolean {
  const scoped = sliceRunScopedMessages(runMessages, runHistoryStartIndex);
  let substantiveEdits = 0;
  let sawVerifyBash = false;

  for (const msg of scoped) {
    if (msg.role !== 'assistant' || !msg.tool_calls?.length) continue;
    for (const tc of msg.tool_calls) {
      const name = normalizeRegisteredToolName(tc.function.name) ?? tc.function.name;
      if (SUBSTANTIVE_TOOL_NAMES.has(name)) substantiveEdits += 1;
      if (isVerifyBashToolName(name, tc.function.arguments)) sawVerifyBash = true;
    }
  }

  return substantiveEdits >= MIN_EDITS_BEFORE_UNVERIFIED_AUDIT && !sawVerifyBash;
}

/** Count substantive edit/delete tool calls in run-scoped history. */
export function countSubstantiveEdits(
  runMessages: readonly ChatMessage[],
  runHistoryStartIndex = 0
): number {
  const scoped = sliceRunScopedMessages(runMessages, runHistoryStartIndex);
  let substantiveEdits = 0;
  for (const msg of scoped) {
    if (msg.role !== 'assistant' || !msg.tool_calls?.length) continue;
    for (const tc of msg.tool_calls) {
      const name = normalizeRegisteredToolName(tc.function.name) ?? tc.function.name;
      if (SUBSTANTIVE_TOOL_NAMES.has(name)) substantiveEdits += 1;
    }
  }
  return substantiveEdits;
}

export function runHasVerifyBashSinceIndex(
  runMessages: readonly ChatMessage[],
  runHistoryStartIndex = 0,
  sinceAssistantMessageIndex = 0
): boolean {
  const scoped = sliceRunScopedMessages(runMessages, runHistoryStartIndex);
  for (let i = sinceAssistantMessageIndex; i < scoped.length; i++) {
    const msg = scoped[i]!;
    if (msg.role !== 'assistant' || !msg.tool_calls?.length) continue;
    for (const tc of msg.tool_calls) {
      const name = normalizeRegisteredToolName(tc.function.name) ?? tc.function.name;
      if (isVerifyBashToolName(name, tc.function.arguments)) return true;
    }
  }
  return false;
}

export function resolveDynamicLoopAuditPrompt(
  runMessages?: readonly ChatMessage[],
  runHistoryStartIndex = 0
): string {
  if (runMessages && runHasUnverifiedSubstantiveEdits(runMessages, runHistoryStartIndex)) {
    return ENHANCED_DYNAMIC_LOOP_AUDIT_PROMPT;
  }
  return DEFAULT_DYNAMIC_LOOP_AUDIT_PROMPT;
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
  auditAwaitingResponse: boolean,
  runMessages?: readonly ChatMessage[],
  runHistoryStartIndex = 0,
  auditInjectionCount = 0,
  substantiveEditsAtLastAudit = 0
): boolean {
  if (auditAwaitingResponse) return false;
  if (auditInjectionCount >= MAX_DYNAMIC_LOOP_AUDIT_INJECTIONS) return false;
  if (actionTools.some((tc) => normalizedToolName(tc) === 'continue')) {
    return false;
  }

  const hasAskUser = finishedToolCalls.some((tc) => normalizedToolName(tc) === 'ask_user');
  if (hasAskUser) return false;

  const hasSubstantiveAction = actionTools.some((tc) => isSubstantiveToolCall(tc));
  const hasFinish = finishedToolCalls.some((tc) => normalizedToolName(tc) === 'finish');

  if (hasSubstantiveAction) {
    const finishOnly = hasFinish && !hasSubstantiveAction;
    return !finishOnly;
  }

  if (
    hasFinish &&
    actionTools.length === 0 &&
    runMessages &&
    runHasUnverifiedSubstantiveEdits(runMessages, runHistoryStartIndex)
  ) {
    if (auditInjectionCount > 0) {
      const editsNow = countSubstantiveEdits(runMessages, runHistoryStartIndex);
      if (editsNow <= substantiveEditsAtLastAudit) {
        return false;
      }
    }
    return true;
  }

  return false;
}

export async function injectDynamicLoopAudit(
  ctx: FollowUpLoopCtx,
  selection: ModelSelection,
  runMessages?: readonly ChatMessage[],
  runHistoryStartIndex = 0
): Promise<FollowUpInjectResult | undefined> {
  if (!ctx.conversationId) return undefined;

  const injected: InjectFollowUpResult = await injectFollowUp({
    followUp: {
      id: randomUUID(),
      kind: 'steering',
      prompt: resolveDynamicLoopAuditPrompt(runMessages, runHistoryStartIndex),
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
