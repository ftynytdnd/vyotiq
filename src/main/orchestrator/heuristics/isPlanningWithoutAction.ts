/**
 * Heuristic: did the assistant emit a turn that produced no user-
 * visible action (no tool call, no `<delegate>`) but clearly intended
 * to continue?
 *
 * After the audit-pass subtraction, this heuristic is intentionally
 * tiny. The consolidated harness (Orchestration Loop §A "Termination",
 * §B "Narrate-and-emit in the same turn") and the new `<run_state>`
 * envelope carry most of the responsibility the older 240-line
 * regex-bandage stack used to: the model can read its own
 * iteration / nudges-remaining / last-action and self-regulate. The
 * heuristic now only catches the two structural patterns the prose
 * cannot detect from the assistant text alone:
 *
 *   1. **Reasoning-only empty turn** — the model produced reasoning
 *      content but emitted no output text, no tool call, and no
 *      `<delegate>`. The provider returned `finish_reason: "stop"`
 *      while the model "thought but didn't act". This is the single
 *      most common cause of phantom early-termination on reasoning
 *      providers and the model has no way to recover from it without
 *      a nudge — there's nothing visible to inspect.
 *
 *   2. **Unclosed `<delegate>` directive** — the model began emitting
 *      a directive (`<delegate id="A1" task="…"`) but the buffer
 *      ended before the closing `/>` or `</delegate>` arrived,
 *      because the provider truncated the turn (`finish_reason:
 *      "length"`) or the model lost the thread. The directive
 *      parser correctly ignores it, so the host's `delegates.length`
 *      is zero and the cleaned text has no actionable content.
 *
 * Visible-completion guards, planning-hint regexes, and clarifying-
 * question terminus checks were ALL removed: the harness explicitly
 * tells the agent that a clarifying-question turn is a clean
 * terminus, and an answer turn ends naturally without needing a
 * regex to recognise it.
 *
 * The cap on nudges per turn (enforced by the caller) bounds the cost
 * of any false-positive to one extra round.
 */

import { STRIP_PARTIAL_TAG_RE } from '@shared/text/strip.js';

/**
 * Detects an unclosed `<delegate ...` tag at any position in the
 * assistant text. Anchored to "no closing `>`/`/>` follows": if the
 * model started a directive but the buffer truncated mid-attribute
 * list, the parser ignored it and the orchestrator would otherwise
 * silently terminate.
 *
 * The shared `STRIP_PARTIAL_TAG_RE` is the renderer-side strip
 * pattern; we re-use it as a detection probe because it captures
 * exactly the same shape we want to flag here. If it matches, there
 * is a partial directive lurking that never closed.
 */
function hasUnclosedDelegate(text: string): boolean {
  return STRIP_PARTIAL_TAG_RE.test(text);
}

interface PlanningCheckInput {
  /** Cleaned assistant text after stripping fully-formed `<delegate>` markup. */
  cleanText: string;
  /** Whether the model emitted any tool calls in this turn. */
  hadToolCall: boolean;
  /** Whether the model emitted any fully-formed <delegate> directives. */
  hadDelegate: boolean;
  /**
   * Whether the model emitted any reasoning content (DeepSeek-style
   * `reasoning_content`, o1-style hidden CoT, etc.). When the output
   * channel is empty but reasoning is present, the model "thought but
   * didn't act" — the worst kind of planning-without-action.
   */
  hadReasoning?: boolean;
  /**
   * Raw assistant text BEFORE delegate-stripping. Used to detect a
   * partial / unclosed `<delegate ...` tag that the parser ignored.
   * Optional — when omitted, the unclosed-delegate detection is
   * skipped (legacy callers and tests that don't supply it).
   */
  rawText?: string;
}

export function isPlanningWithoutAction(input: PlanningCheckInput): boolean {
  // Action of any kind always overrides — the loop is making progress.
  if (input.hadToolCall || input.hadDelegate) return false;

  // Unclosed `<delegate>` directive: the model TRIED to delegate but
  // the buffer truncated before the closing `/>`. Nudge so the next
  // turn re-emits a complete directive instead of silently ending.
  if (typeof input.rawText === 'string' && hasUnclosedDelegate(input.rawText)) {
    return true;
  }

  const text = input.cleanText.trim();
  // Reasoning-only empty turn: the model produced no output channel
  // content at all. Nudge so the next turn emits something visible.
  if (text.length === 0 && input.hadReasoning === true) return true;

  // Anything else — including substantive answers, clarifying
  // questions, completion narrations, and short acknowledgements —
  // is a clean terminus. The harness handles the rest.
  return false;
}
