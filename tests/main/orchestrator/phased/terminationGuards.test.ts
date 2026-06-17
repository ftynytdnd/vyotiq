import { describe, expect, it } from 'vitest';
import {
  checkTerminationGuards,
  createTerminationGuardState,
  recordFailureForNoProgress
} from '../../../../src/main/orchestrator/phased/terminationGuards.js';
import { MAX_TOTAL_ITERATIONS } from '../../../../src/shared/constants.js';

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

  it('trips no-progress after duplicate failure signature', () => {
    const state = createTerminationGuardState(8);
    recordFailureForNoProgress(state, 'verify', 'tests failed', 'test_failure');
    recordFailureForNoProgress(state, 'verify', 'tests failed', 'test_failure');
    const trip = checkTerminationGuards(state, {});
    expect(trip?.kind).toBe('no_progress');
    if (trip?.kind === 'no_progress') expect(trip.count).toBeGreaterThanOrEqual(2);
  });
});
