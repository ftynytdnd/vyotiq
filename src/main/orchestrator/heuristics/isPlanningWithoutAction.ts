/**
 * Heuristic: did the assistant emit a turn that produced no user-
 * visible action (no tool call, no `<delegate>`) but clearly intended
 * to continue?
 *
 * After the audit-pass subtraction (and the May-26 follow-up that
 * removed the `unclosed-delegate` re-emit nudge), this heuristic is
 * intentionally tiny. The consolidated harness (Orchestration Loop
 * §A "Termination", §B "Narrate-and-emit in the same turn") and the
 * `<run_state>` envelope carry most of the responsibility the older
 * 240-line regex-bandage stack used to: the model can read its own
 * iteration / nudges-remaining / last-action and self-regulate. The
 * heuristic now only catches the single structural pattern the
 * prose cannot detect from the assistant text alone:
 *
 *   - **Reasoning-only empty turn** — the model produced reasoning
 *     content but emitted no output text, no tool call, and no
 *     `<delegate>`. The provider returned `finish_reason: "stop"`
 *     while the model "thought but didn't act". This is the single
 *     most common cause of phantom early-termination on reasoning
 *     providers and the model has no way to recover from it without
 *     a nudge — there's nothing visible to inspect.
 *
 * The previous "unclosed `<delegate>` directive" detection was
 * removed because (a) the `parseDelegates` parser already silently
 * ignores partial tags, (b) the `stripDelegatesForDisplay` strip
 * keeps the partial XML out of the rendered timeline, and (c) when
 * the provider truncates a turn (`finish_reason: "length"`) the
 * `<run_state>` envelope already exposes that signal — the model
 * self-regulates without a host-side re-emit nudge. Visible-
 * completion guards, planning-hint regexes, clarifying-question
 * terminus checks, and colon-handoff detectors were similarly
 * removed: the harness explicitly tells the agent that a clarifying-
 * question turn is a clean terminus, and the Ollama transport now
 * round-trips `reasoning_content` ↔ `thinking` so the model retains
 * its planning chain-of-thought across turns (see
 * `providers/ollamaChatStream.ts:toOllamaMessage`). Without that
 * round-trip, a model that planned in reasoning and emitted only a
 * brief content announcement could not recover its plan on the next
 * turn and stalled in a narration loop — the regex bandages that
 * used to flag the announcement turn were treating the symptom of
 * that transport bug, not the cause.
 *
 * The cap on nudges per turn (enforced by the caller) bounds the cost
 * of any false-positive to one extra round; after that the run halts
 * with a visible error rather than a silent return.
 */

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
}

/**
 * Structured reason a turn was flagged for nudging. Surfaced via
 * `classifyPlanningWithoutAction` so the caller can pick the right
 * human-readable label and the correct nudge body. The legacy
 * boolean predicate `isPlanningWithoutAction` is preserved as a thin
 * wrapper for callers that only need the yes/no signal.
 *
 *   - `reasoning-only`: empty output channel + reasoning produced.
 *     Tell the model to act in the output channel.
 *   - `none`: clean terminus — caller should accept the turn.
 */
export type PlanningOutcome = 'reasoning-only' | 'none';

export function classifyPlanningWithoutAction(
  input: PlanningCheckInput
): PlanningOutcome {
  // Action of any kind always overrides — the loop is making progress.
  if (input.hadToolCall || input.hadDelegate) return 'none';

  const text = input.cleanText.trim();
  // Reasoning-only empty turn: the model produced no output channel
  // content at all. Nudge so the next turn emits something visible.
  if (text.length === 0 && input.hadReasoning === true) return 'reasoning-only';

  // Anything else — including substantive answers, clarifying
  // questions, completion narrations, short acknowledgements, and
  // turns that contain a partial / unclosed `<delegate>` tag — is a
  // clean terminus. The harness handles the rest, and the transport-
  // level reasoning round-trip ensures the model has the continuity
  // it needs across turns.
  return 'none';
}

/**
 * Boolean predicate kept for backward compatibility with the legacy
 * call sites and tests. Returns `true` when `classifyPlanningWithoutAction`
 * picks any non-`'none'` outcome.
 */
export function isPlanningWithoutAction(input: PlanningCheckInput): boolean {
  return classifyPlanningWithoutAction(input) !== 'none';
}
