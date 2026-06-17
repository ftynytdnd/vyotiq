/**
 * Termination guards — iteration caps, no-progress detector, budget hooks.
 */

import { MAX_TOTAL_ITERATIONS, PHASED_SOFT_ITERATION_MARGIN } from '@shared/constants.js';
import type { DiagnoseClassification, ExecutionPhase, PersistedGuardState } from '@shared/types/phased.js';
import { failureSignature } from './diagnoseRouter.js';

export type TerminationGuardState = PersistedGuardState;

/**
 * Clamp a requested soft global-iteration cap so it always trips a fixed margin
 * below the hard `MAX_TOTAL_ITERATIONS` ceiling. This guarantees the phased
 * escape hatch surfaces to the human before the loop's forced-synthesis
 * fallback (which would otherwise mask it). Floored at 2 so tiny configured
 * caps remain usable. Shared by fresh state and transcript reconstruction.
 */
export function effectiveGlobalIterationCap(requested: number): number {
  const ceiling = Math.max(2, MAX_TOTAL_ITERATIONS - PHASED_SOFT_ITERATION_MARGIN);
  return Math.max(2, Math.min(requested, ceiling));
}

export function createTerminationGuardState(
  phaseCycleCap: number,
  globalIterationCap: number = MAX_TOTAL_ITERATIONS
): TerminationGuardState {
  return {
    phaseCyclesUsed: 0,
    phaseCycleCap,
    globalIteration: 0,
    globalIterationCap: effectiveGlobalIterationCap(globalIterationCap),
    lastFailureSignature: null,
    repeatFailureCount: 0
  };
}

export type GuardTripReason =
  | { kind: 'global_iteration_cap'; iteration: number; cap: number }
  | { kind: 'phase_cycle_cap'; used: number; cap: number }
  | { kind: 'no_progress'; signature: string; count: number }
  | { kind: 'token_budget' }
  | { kind: 'wall_clock_budget' };

export function recordFailureForNoProgress(
  state: TerminationGuardState,
  phase: ExecutionPhase,
  message: string,
  classification?: DiagnoseClassification
): void {
  const sig = failureSignature({ phase, classification, message });
  if (state.lastFailureSignature === sig) {
    state.repeatFailureCount += 1;
  } else {
    state.lastFailureSignature = sig;
    state.repeatFailureCount = 1;
  }
}

export function clearNoProgress(state: TerminationGuardState): void {
  state.lastFailureSignature = null;
  state.repeatFailureCount = 0;
}

export function checkTerminationGuards(
  state: TerminationGuardState,
  opts: { tokenBudgetExceeded?: boolean; wallClockExceeded?: boolean }
): GuardTripReason | null {
  if (opts.tokenBudgetExceeded) return { kind: 'token_budget' };
  if (opts.wallClockExceeded) return { kind: 'wall_clock_budget' };
  const globalCap = Math.min(state.globalIterationCap, MAX_TOTAL_ITERATIONS);
  if (state.globalIteration >= globalCap) {
    return {
      kind: 'global_iteration_cap',
      iteration: state.globalIteration,
      cap: globalCap
    };
  }
  if (state.phaseCyclesUsed >= state.phaseCycleCap) {
    return { kind: 'phase_cycle_cap', used: state.phaseCyclesUsed, cap: state.phaseCycleCap };
  }
  if (state.repeatFailureCount >= 2) {
    return {
      kind: 'no_progress',
      signature: state.lastFailureSignature ?? '',
      count: state.repeatFailureCount
    };
  }
  return null;
}

export function incrementPhaseCycle(state: TerminationGuardState): void {
  state.phaseCyclesUsed += 1;
}
