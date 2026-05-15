/**
 * Builds the `<run_state>` envelope — a small, machine-readable summary
 * of what the host knows about THIS run that the model would otherwise
 * have to guess at. Surfacing it lets the model self-regulate (e.g.,
 * "I've burned 1 of 2 nudges — I should stop drafting plans without
 * action") instead of relying entirely on reactive heuristics.
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
import type { DelegationCounters } from './handleDelegates.js';
import type { NudgeState } from './handleNoToolNoDelegate.js';
import type { SpinSignatureBuffer } from './toolSpinSignature.js';
import { MAX_NUDGES_PER_RUN } from './handleNoToolNoDelegate.js';
import { MAX_TOTAL_ITERATIONS } from '@shared/constants.js';

/**
 * Last meaningful action the loop performed. Mirrors the iteration
 * branches in `runLoop.ts` so the model sees a coherent trail rather
 * than having to infer it from the message history.
 *   - `none`            — first iteration, nothing has happened yet.
 *   - `direct-tool`     — orchestrator-level tool round (ls/memory/recall).
 *   - `delegate`        — one or more sub-agents finished a round.
 *   - `nudge`           — host injected a planning-without-action user
 *                          message (the spin nudge variant was removed
 *                          in the subtraction-pass).
 *   - `retry`           — provider transport error triggered backoff.
 *   - `clarify`         — assistant emitted a clarifying question
 *                          (substantive text ending in `?`).
 *   - `answer`          — assistant delivered a substantive final-text turn.
 */
type LastAction =
  | 'none'
  | 'direct-tool'
  | 'delegate'
  | 'nudge'
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
  /**
   * Planning-without-action nudges already burned and the budget. The
   * spin-nudge counter that used to live here was removed in the
   * subtraction-pass — see file header.
   */
  nudges: {
    planning: { used: number; max: number };
  };
  /** Most recent transition. Empty on iteration 0. */
  lastAction: LastAction;
  /**
   * If a single tool-call signature has recurred enough to fill the
   * observability buffer, surface it so the model can pre-emptively
   * pivot before the per-run tool-result cache starts prepending its
   * "you already issued this" banner. `null` when nothing is hot.
   */
  spinSignatureHot: string | null;
}

/**
 * Render the view as a human-readable block. Stable layout — same order
 * every iteration — so the model can pattern-match it.
 */
export function buildRunStateXml(view: RunStateView): string {
  const lines: string[] = [
    `iteration: ${view.iteration} of ${MAX_TOTAL_ITERATIONS}`,
    `direct_tool_rounds: ${view.directToolRounds.total} ` +
    `(consecutive_failed: ${view.directToolRounds.consecutiveFailed})`,
    `delegate_rounds: ${view.delegateRounds.total} ` +
    `(consecutive_bad: ${view.delegateRounds.consecutiveBad})`,
    `planning_nudges: ${view.nudges.planning.used} of ${view.nudges.planning.max} used`,
    `last_action: ${view.lastAction}`,
    `spin_signature_hot: ${view.spinSignatureHot ?? '(none)'}`
  ];
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
}

export function createRunStateAccumulator(): RunStateAccumulator {
  return {
    iteration: 0,
    directToolRoundsTotal: 0,
    delegateRoundsTotal: 0,
    lastAction: 'none',
    spinSignatureHot: null
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
  nudges: NudgeState,
  _spin: SpinSignatureBuffer,
  consecutiveBadToolRounds: number
): RunStateView {
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
    nudges: {
      planning: { used: nudges.used, max: MAX_NUDGES_PER_RUN }
    },
    lastAction: acc.lastAction,
    spinSignatureHot: acc.spinSignatureHot
  };
}
