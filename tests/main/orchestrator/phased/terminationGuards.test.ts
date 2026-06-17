import { describe, expect, it } from 'vitest';
import {
  checkTerminationGuards,
  createTerminationGuardState,
  effectiveGlobalIterationCap,
  recordFailureForNoProgress
} from '../../../../src/main/orchestrator/phased/terminationGuards.js';
import {
  MAX_TOTAL_ITERATIONS,
  PHASED_SOFT_ITERATION_MARGIN
} from '../../../../src/shared/constants.js';

describe('terminationGuards', () => {
  it('trips phase cycle cap', () => {
    const state = createTerminationGuardState(3);
    state.phaseCyclesUsed = 3;
    const trip = checkTerminationGuards(state, {});
    expect(trip?.kind).toBe('phase_cycle_cap');
  });

  it('trips global iteration cap', () => {
    const state = createTerminationGuardState(8);
    state.globalIteration = MAX_TOTAL_ITERATIONS;
    const trip = checkTerminationGuards(state, {});
    expect(trip?.kind).toBe('global_iteration_cap');
  });

  it('keeps the soft global cap a margin below the hard ceiling', () => {
    // The escape hatch must surface before the loop's forced-synthesis fallback.
    const soft = MAX_TOTAL_ITERATIONS - PHASED_SOFT_ITERATION_MARGIN;
    expect(effectiveGlobalIterationCap(MAX_TOTAL_ITERATIONS)).toBe(soft);

    const state = createTerminationGuardState(8, MAX_TOTAL_ITERATIONS);
    expect(state.globalIterationCap).toBe(soft);

    state.globalIteration = soft - 1;
    expect(checkTerminationGuards(state, {})).toBeNull();

    state.globalIteration = soft;
    expect(checkTerminationGuards(state, {})?.kind).toBe('global_iteration_cap');
  });

  it('floors and clamps the soft cap for out-of-range requests', () => {
    expect(effectiveGlobalIterationCap(1)).toBe(2);
    expect(effectiveGlobalIterationCap(1000)).toBe(MAX_TOTAL_ITERATIONS - PHASED_SOFT_ITERATION_MARGIN);
  });

  it('trips no-progress after duplicate failure signature', () => {
    const state = createTerminationGuardState(8);
    recordFailureForNoProgress(state, 'verify', 'tests failed', 'test_failure');
    recordFailureForNoProgress(state, 'verify', 'tests failed', 'test_failure');
    const trip = checkTerminationGuards(state, {});
    expect(trip?.kind).toBe('no_progress');
    if (trip?.kind === 'no_progress') expect(trip.count).toBeGreaterThanOrEqual(2);
  });
});
