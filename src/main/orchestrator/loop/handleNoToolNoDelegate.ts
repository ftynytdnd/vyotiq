/**
 * Handles the "no tool calls, no delegates" branch of the orchestration
 * loop. Two outcomes:
 *
 *   - `terminate`: clean text answer, clarifying question, or
 *     completion narration — the agent is done for this user prompt.
 *
 *   - `continue`: the agent emitted reasoning only. Push a short
 *     user-side nudge and keep iterating, capped at
 *     `MAX_NUDGES_PER_RUN` to prevent ping-pong.
 *
 * Emits a `phase` event when nudging so the timeline shows the host's
 * intervention transparently. When the nudge budget is exhausted on a
 * still-flagged turn, the loop surfaces a visible `error` event so
 * the run halts loudly instead of returning silently — the silent-
 * stoppage regression backstop captured in the audit follow-up.
 *
 * The actual ROOT CAUSE of the silent-stoppage observed during the
 * audit was a transport-layer bug: the Ollama transport was stripping
 * the assistant's `reasoning_content` on outgoing messages, so a
 * thinking-capable model that planned in `thinking` and emitted only
 * a brief content announcement could not recover its plan on the
 * next turn. That round-trip is now correctly preserved (see
 * `providers/ollamaChatStream.ts:toOllamaMessage`). This module is
 * the structural backstop for the rare case the model still desyncs.
 *
 * Subtraction note (May 26): the `unclosed-delegate` re-emit nudge
 * was removed. A truncated `<delegate ...` tag is already silently
 * ignored by `parseDelegates`, the renderer-side
 * `stripDelegatesForDisplay` keeps the partial XML out of the
 * timeline, and the `<run_state>` / `<runtime_limits>` envelopes
 * already give the model the iteration / finish-reason context it
 * needs to recover on its own. The host-side re-emit ask was extra
 * machinery on top of those guarantees.
 */

import { randomUUID } from 'node:crypto';
import type { ChatMessage, TimelineEvent } from '@shared/types/chat.js';
import {
  classifyPlanningWithoutAction,
  type PlanningOutcome
} from '../heuristics/index.js';
import { emitRunStatus } from './emitRunStatus.js';
import { logger } from '../../logging/logger.js';

const log = logger.child('orch/terminus');

export const MAX_NUDGES_PER_RUN = 2;

/**
 * Nudge for reasoning-only empty turns. Reasoning content (DeepSeek
 * `reasoning_content`, Ollama `thinking`, o1-style hidden CoT) is
 * round-tripped to the next turn but it is invisible to the
 * orchestrator's terminus check and to the user — only the OUTPUT
 * channel (text / tool_calls / <delegate>) counts as action. Spell
 * that out so the model emits the plan it just drafted internally.
 */
const REASONING_ONLY_NUDGE_TEXT =
  'Your previous turn produced reasoning only — no output text, no tool call, and ' +
  'no `<delegate ... />` directive. Reasoning is replayed on your next turn but ' +
  'cannot perform work on its own. Emit the actual `<delegate ... />` directives for ' +
  'the next step now, or, if you are truly finished, state plainly in the output ' +
  'channel that the task is complete.';

export interface NudgeState {
  used: number;
}

export type TerminusOutcome = 'continue' | 'terminate';

/** Variant key used internally and in structured logs. Stable. */
type NudgeVariant = Exclude<PlanningOutcome, 'none'>;

/**
 * Plain-English, action-oriented copy for the user-facing phase divider
 * and live-status row. Stays separate from the structured `variant` key
 * so log greps and humanized UX evolve independently — the technical
 * labels never reach the user, the human labels never reach the logs.
 */
const HUMAN_NUDGE_LABEL: Record<NudgeVariant, string> = {
  'reasoning-only': 'Asking the agent to act after silent reasoning'
};

/** Body copy for each nudge variant. */
const NUDGE_BODY: Record<NudgeVariant, string> = {
  'reasoning-only': REASONING_ONLY_NUDGE_TEXT
};

export function handleNoToolNoDelegate(
  cleanText: string,
  finishReason: string | undefined,
  hadReasoning: boolean,
  messages: ChatMessage[],
  nudges: NudgeState,
  emit: (event: TimelineEvent) => void
): TerminusOutcome {
  const outcome = classifyPlanningWithoutAction({
    cleanText,
    hadToolCall: false,
    hadDelegate: false,
    hadReasoning
  });

  // Hopeless-reasoning short-circuit: the model emitted reasoning but
  // no output channel content, the provider's `finish_reason` was the
  // clean `stop`, and we already burned one nudge. The second nudge
  // against this exact state is wasted budget — the model already saw
  // the first nudge and answered with reasoning + nothing again.
  // Halt after a single nudge instead of two. Detected from the
  // production conversation (`e6859f7b-...jsonl`): two back-to-back
  // `reasoning-only` nudges with `cleanTextLen=0` then the model
  // tried `delegate` as a tool call and was allow-list refused —
  // every iteration was wasted.
  const isHopelessReasoning =
    outcome === 'reasoning-only' &&
    cleanText.length === 0 &&
    finishReason === 'stop';
  const effectiveBudget = isHopelessReasoning ? 1 : MAX_NUDGES_PER_RUN;

  if (outcome !== 'none' && nudges.used < effectiveBudget) {
    nudges.used += 1;
    const variant: NudgeVariant = outcome;
    log.info('emitting planning-without-action nudge', {
      used: nudges.used,
      max: effectiveBudget,
      // Structured variant key kept stable for log greps; never user-facing.
      variant,
      cleanTextLen: cleanText.length,
      finishReason,
      hopelessReasoning: isHopelessReasoning
    });
    const human = HUMAN_NUDGE_LABEL[variant];
    const counter = `${nudges.used}/${MAX_NUDGES_PER_RUN}`;
    emit({
      kind: 'phase',
      id: randomUUID(),
      ts: Date.now(),
      label: `${human} (${counter})`
    });
    emitRunStatus(
      emit,
      'nudging',
      `${human} (${counter})…`,
      { attempt: nudges.used, maxAttempts: MAX_NUDGES_PER_RUN }
    );
    messages.push({
      role: 'user',
      content: NUDGE_BODY[variant]
    });
    return 'continue';
  }

  // Nudge budget exhausted on a still-flagged turn. Two cases:
  //
  //   (a) `outcome !== 'none'` — the model kept producing the same
  //       structural pattern after the nudge budget. Surface a
  //       visible `error` event so the user sees the failure instead
  //       of a silent return (matches the three-strike halts
  //       elsewhere in the loop).
  //
  //   (b) `outcome === 'none'` — clean terminus. Pre-audit behavior
  //       preserved: emit a low-key `agent-thought` diagnostic only
  //       when the turn was empty, never on a real answer.
  if (outcome !== 'none') {
    log.warn('halting after exhausted nudge budget on still-flagged turn', {
      variant: outcome,
      nudgesUsed: nudges.used,
      effectiveBudget,
      finishReason,
      cleanTextLen: cleanText.length,
      hopelessReasoning: isHopelessReasoning
    });
    emit({
      kind: 'error',
      id: randomUUID(),
      ts: Date.now(),
      message:
        `Run halted: the agent did not emit a <delegate /> directive or tool ` +
        `call after ${nudges.used} nudge${nudges.used === 1 ? '' : 's'}. ` +
        `Re-send the request, simplify the prompt, or switch to a stronger model.`
    });
    return 'terminate';
  }

  if (cleanText.length === 0) {
    log.debug('terminating on empty turn', {
      finishReason,
      hadReasoning,
      nudgesUsed: nudges.used
    });
    emit({
      kind: 'agent-thought',
      id: randomUUID(),
      ts: Date.now(),
      content:
        finishReason && finishReason !== 'stop'
          ? `(turn ended: ${finishReason})`
          : '(empty assistant turn — stopping)'
    });
    // Audit fix M-08: an empty assistant turn is almost always a
    // symptom of a provider misconfiguration (wrong model id,
    // unsupported reasoning-only model, a transport that silently
    // dropped the assistant message, etc.). Without an explicit
    // breadcrumb the user just sees the orchestrator stop with no
    // visible reason — diagnostic dead-end. Emit a `phase` warning
    // so the breadcrumb lands on the timeline AND in the structured
    // logs.
    emit({
      kind: 'phase',
      id: randomUUID(),
      ts: Date.now(),
      label:
        finishReason && finishReason !== 'stop'
          ? `empty turn (provider finish_reason=${finishReason})`
          : hadReasoning
            ? 'empty turn (reasoning-only — model returned no output text)'
            : 'empty turn (provider returned no content)'
    });
  } else {
    log.debug('terminating after clean assistant text', {
      finishReason,
      cleanTextLen: cleanText.length,
      nudgesUsed: nudges.used
    });
  }
  return 'terminate';
}
