/**
 * Builds the `<run_state>` envelope — a small, machine-readable summary
 * of what the host knows about THIS run that the model would otherwise
 * have to guess at. Surfacing it lets the model self-regulate (e.g.,
 * "I'm on iteration 20 of 24 — I should wrap up and call `finish`")
 * instead of relying on reactive host-side heuristics.
 *
 * The envelope is rebuilt once per orchestrator iteration and inserted
 * between `<session_context>` and `<prior_conversations>` — see
 * `buildSystemPrompt.ts` for the full layout. Sub-agents do not see
 * this envelope (their context is intentionally isolated).
 *
 * Subtraction-pass note: the `spin_nudges` counter line was REMOVED
 * when the host-side spin nudge / halt path was deleted. The
 * `spin_signature_hot` line stayed — it is pure observability the
 * model uses to pivot before the per-run tool-result cache prepends
 * its "you already issued this" banner. The cache banner now owns
 * the formerly-spin-detector responsibility on the SECOND identical
 * call (the spin detector fired on the THIRD), so the prior detector
 * was strictly redundant.
 *
 * Cost: ~5 short lines of text per iteration, well under 50 tokens.
 * Benefit: the model gets a deterministic view of its own loop state,
 * which is exactly what the Stanford "harness over architecture"
 * results suggest helps far more than another reactive nudge.
 */

import { wrapXml } from '../envelope/index.js';
import { escapeXmlBody } from '../envelope/escapeXmlBody.js';
import type { DelegationCounters } from './handleDelegates.js';
import type { SpinSignatureBuffer } from './toolSpinSignature.js';
import { MAX_TOTAL_ITERATIONS } from '@shared/constants.js';

/**
 * Last meaningful action the loop performed. Mirrors the iteration
 * branches in `runLoop.ts` so the model sees a coherent trail rather
 * than having to infer it from the message history.
 *   - `none`            — first iteration, nothing has happened yet.
 *   - `direct-tool`     — orchestrator-level tool round (ls/memory/recall).
 *   - `delegate`        — one or more sub-agents finished a round.
 *   - `retry`           — provider transport error (or an empty forced
 *                          turn) triggered a re-issue.
 *   - `clarify`         — assistant called `ask_user` to pause the run.
 *   - `answer`          — assistant called `finish` (or an implicit
 *                          finish via substantive prose on a non-forced
 *                          dialect) and delivered the final answer.
 */
type LastAction =
  | 'none'
  | 'direct-tool'
  | 'delegate'
  | 'retry'
  | 'clarify'
  | 'answer';

export interface RunStateView {
  /** Zero-indexed iteration the host is ABOUT to enter. */
  iteration: number;
  /** Direct-tool rounds completed so far, with consecutive-failure count. */
  directToolRounds: { total: number; consecutiveFailed: number };
  /** Delegate rounds completed, with consecutive-bad count. */
  delegateRounds: { total: number; consecutiveBad: number };
  /** Most recent transition. Empty on iteration 0. */
  lastAction: LastAction;
  /**
   * If a single tool-call signature has recurred enough to fill the
   * observability buffer, surface it so the model can pre-emptively
   * pivot before the per-run tool-result cache starts prepending its
   * "you already issued this" banner. `null` when nothing is hot.
   */
  spinSignatureHot: string | null;
  /**
   * Sub-agent tasks whose bad-verdict streak has reached `2` or more.
   * The model sees them as "this exact decomposition is not working —
   * pick a different angle of attack". Empty when nothing is hot.
   * Each entry's `signature` is the same key the orchestrator
   * maintains in `DelegationCounters.perTaskBadStreak`; surfaced
   * truncated for display.
   */
  failingTasks: Array<{ signature: string; streak: number }>;
  /**
   * Consecutive orchestrator iterations that delegated exactly one worker
   * with no co-emitted direct tools — soft signal to fan out in one turn.
   */
  serialSingleDelegateRounds: number;
}

/**
 * Render the view as a human-readable block. Stable layout — same order
 * every iteration — so the model can pattern-match it.
 */
export function buildRunStateXml(view: RunStateView): string {
  const lines: string[] = [
    `iteration: ${view.iteration} of ${MAX_TOTAL_ITERATIONS}`,
    `direct_tool_rounds: ${view.directToolRounds.total} ` +
    `(consecutive_failed_tools: ${view.directToolRounds.consecutiveFailed})`,
    `delegate_rounds: ${view.delegateRounds.total} ` +
    `(consecutive_bad_delegation: ${view.delegateRounds.consecutiveBad})`,
    `last_action: ${view.lastAction}`,
    `spin_signature_hot: ${view.spinSignatureHot ?? '(none)'}`
  ];
  if (view.failingTasks.length > 0) {
    // Render the failing-task list as one line per task so a single
    // grep over `<run_state>` lines surfaces both the counter and the
    // body. Truncate the signature display so a long task body
    // doesn't blow out the prompt width; the orchestrator's
    // structured log carries the full key for triage.
    const body = view.failingTasks
      .map((t) => {
        // Escape the signature head (review finding H5). Task
        // signatures are derived from model-controlled `<delegate
        // task="..."/>` strings; an unescaped `</run_state>` in a
        // task body would otherwise let a malicious tool output
        // (or a confused model) break out of the run-state envelope
        // and inject pseudo-instructions into both the orchestrator
        // prompt (which threads this block verbatim). Prime
        // Directives §6 boundary defense. The numeric framework
        // around `head` (`streak`, `slice(0, 80)`) is host-built
        // and trusted; only the user-derived head needs escaping.
        const rawHead = t.signature.split('|')[0] ?? t.signature;
        const head = escapeXmlBody(rawHead.slice(0, 80));
        return `  - streak ${t.streak}: ${head}`;
      })
      .join('\n');
    lines.push('failing_tasks:\n' + body);
  } else {
    lines.push('failing_tasks: (none)');
  }
  if (view.serialSingleDelegateRounds >= 3) {
    lines.push(
      'delegate_parallel_hint: You have emitted one delegate per turn for ' +
        `${view.serialSingleDelegateRounds} consecutive rounds — when sub-tasks ` +
        'are independent, emit multiple `delegate` tool calls in the same assistant turn.'
    );
  }
  return wrapXml('run_state', lines.join('\n'));
}

/**
 * Mutable run-state collector. The orchestrator loop owns one of these
 * for the duration of a run and updates it after each iteration's
 * authoritative branch (tool round / delegate round / nudge / answer).
 *
 * Kept structural (no methods on the data shape) so it composes with the
 * existing `counters: DelegationCounters` / `nudges: NudgeState` /
 * `spin: SpinSignatureBuffer` references already threaded through
 * `runLoop.ts`.
 */
export interface RunStateAccumulator {
  iteration: number;
  directToolRoundsTotal: number;
  delegateRoundsTotal: number;
  lastAction: LastAction;
  spinSignatureHot: string | null;
  serialSingleDelegateRounds: number;
}

export function createRunStateAccumulator(): RunStateAccumulator {
  return {
    iteration: 0,
    directToolRoundsTotal: 0,
    delegateRoundsTotal: 0,
    lastAction: 'none',
    spinSignatureHot: null,
    serialSingleDelegateRounds: 0
  };
}

/**
 * Compose a snapshot from the live mutable refs the loop carries. The
 * accumulator owns "history" fields (totals, last action), while the
 * counters / nudges refs own the per-event state. Reading them
 * together produces the user-visible view.
 *
 * `_spin` is accepted but not consumed by this view — the
 * `spin_signature_hot` value is read off `acc` (the run loop refreshes
 * it via `spinHotSignature(spin)` once per iteration). The parameter
 * is kept in the signature so call sites continue to pass the buffer
 * through; a future refactor can drop the parameter once every
 * caller is updated.
 */
export function snapshotRunState(
  acc: RunStateAccumulator,
  counters: DelegationCounters,
  _spin: SpinSignatureBuffer,
  consecutiveBadToolRounds: number
): RunStateView {
  // Only surface failing tasks with streak >= 2 so the run_state
  // doesn't churn for first-time failures (which the model is
  // expected to recover from on its own). Sort newest/hottest first
  // so the top of the list draws attention.
  const failingTasks: Array<{ signature: string; streak: number }> = [];
  for (const [signature, streak] of counters.perTaskBadStreak.entries()) {
    if (streak >= 2) failingTasks.push({ signature, streak });
  }
  failingTasks.sort((a, b) => b.streak - a.streak);
  return {
    iteration: acc.iteration,
    directToolRounds: {
      total: acc.directToolRoundsTotal,
      consecutiveFailed: consecutiveBadToolRounds
    },
    delegateRounds: {
      total: acc.delegateRoundsTotal,
      consecutiveBad: counters.consecutiveBadRounds
    },
    lastAction: acc.lastAction,
    spinSignatureHot: acc.spinSignatureHot,
    failingTasks,
    serialSingleDelegateRounds: acc.serialSingleDelegateRounds
  };
}
