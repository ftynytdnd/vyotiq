/**
 * Handles the "no tool calls, no delegates" branch of the orchestration
 * loop. Two outcomes:
 *
 *   - `terminate`: clean text answer, clarifying question, or
 *     completion narration — the agent is done for this user prompt.
 *
 *   - `continue`: the agent emitted reasoning only OR an unclosed
 *     `<delegate ...` directive. Push a short user-side nudge and keep
 *     iterating, capped at `MAX_NUDGES_PER_RUN` to prevent ping-pong.
 *
 * Emits a `phase` event when nudging so the timeline shows the host's
 * intervention transparently.
 *
 * The previous "planning hint" / "completion phrase" / "clarifying-
 * question terminus" surface was removed in the audit pass — the
 * consolidated harness ("Termination" + "Narrate-and-emit in the same
 * turn") and the new `<run_state>` envelope carry that responsibility.
 */

import { randomUUID } from 'node:crypto';
import type { ChatMessage, TimelineEvent } from '@shared/types/chat.js';
import { isPlanningWithoutAction } from '../heuristics/index.js';
import { emitRunStatus } from './emitRunStatus.js';
import { logger } from '../../logging/logger.js';

const log = logger.child('orch/terminus');

export const MAX_NUDGES_PER_RUN = 2;

/**
 * Nudge for an unclosed `<delegate ...` tag. The model began a
 * directive but the buffer cut off mid-attribute. Tell it explicitly
 * to re-emit the directive cleanly so the next turn isn't another
 * truncated retry.
 */
const UNCLOSED_DELEGATE_NUDGE_TEXT =
  'Your previous turn started a `<delegate ...` directive but did not close it ' +
  '(`/>` or `</delegate>` is missing). The host could not parse it and no sub-agent ' +
  'spawned. Re-emit the COMPLETE directive on a single logical line, then continue.';

/**
 * Nudge for reasoning-only empty turns. Reasoning content (DeepSeek
 * `reasoning_content`, o1-style hidden CoT) is invisible to the
 * orchestrator's terminus check and to the user — only the output
 * channel (text / tool_calls / <delegate>) counts as action. Spell
 * that out so the model emits the plan it just drafted internally.
 */
const REASONING_ONLY_NUDGE_TEXT =
  'Your previous turn produced reasoning only — no output text, no tool call, and ' +
  'no `<delegate ... />` directive. Reasoning is invisible to the orchestrator and ' +
  'cannot perform work. Emit the actual `<delegate ... />` directives for the next ' +
  'step now, or, if you are truly finished, state plainly in the output channel ' +
  'that the task is complete.';

export interface NudgeState {
  used: number;
}

export type TerminusOutcome = 'continue' | 'terminate';

/** Variant key used internally and in structured logs. Stable. */
type NudgeVariant = 'unclosed-delegate' | 'reasoning-only' | 'planning';

/**
 * Plain-English, action-oriented copy for the user-facing phase divider
 * and live-status row. Stays separate from the structured `variant` key
 * so log greps and humanized UX evolve independently — the technical
 * labels never reach the user, the human labels never reach the logs.
 */
const HUMAN_NUDGE_LABEL: Record<NudgeVariant, string> = {
  'unclosed-delegate': 'Asking the agent to re-emit the directive',
  'reasoning-only': 'Asking the agent to act after silent reasoning',
  'planning': 'Reminding the agent to make progress'
};

export interface HandleNoToolNoDelegateExtras {
  /**
   * Raw assistant text BEFORE delegate-stripping. Forwarded to the
   * heuristic so it can detect an unclosed `<delegate ...` tag the
   * parser ignored.
   */
  rawText?: string;
}

export function handleNoToolNoDelegate(
  cleanText: string,
  finishReason: string | undefined,
  hadReasoning: boolean,
  messages: ChatMessage[],
  nudges: NudgeState,
  emit: (event: TimelineEvent) => void,
  extras: HandleNoToolNoDelegateExtras = {}
): TerminusOutcome {
  const planningWithoutAction = isPlanningWithoutAction({
    cleanText,
    hadToolCall: false,
    hadDelegate: false,
    hadReasoning,
    ...(extras.rawText !== undefined ? { rawText: extras.rawText } : {})
  });

  if (planningWithoutAction && nudges.used < MAX_NUDGES_PER_RUN) {
    nudges.used += 1;
    // Variant selection: an unclosed-delegate signal trumps the
    // reasoning-only variant because it tells the model exactly what
    // to fix structurally. Reasoning-only is the fallback for
    // empty-output turns.
    const isUnclosed = typeof extras.rawText === 'string' &&
      /<\/?delegate\b[^<]*$/i.test(extras.rawText);
    const reasoningOnly = !isUnclosed && cleanText.length === 0 && hadReasoning;
    const variant: NudgeVariant = isUnclosed
      ? 'unclosed-delegate'
      : reasoningOnly
        ? 'reasoning-only'
        : 'planning';
    log.info('emitting planning-without-action nudge', {
      used: nudges.used,
      max: MAX_NUDGES_PER_RUN,
      // Structured variant key kept stable for log greps; never user-facing.
      variant,
      cleanTextLen: cleanText.length,
      finishReason
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
      content: isUnclosed
        ? UNCLOSED_DELEGATE_NUDGE_TEXT
        : REASONING_ONLY_NUDGE_TEXT
    });
    return 'continue';
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
  } else {
    log.debug('terminating after clean assistant text', {
      finishReason,
      cleanTextLen: cleanText.length,
      nudgesUsed: nudges.used
    });
  }
  return 'terminate';
}
