/**
 * Review finding H5 — runtime-limit constants must satisfy the
 * relationships the orchestrator's three-strike + per-task strike
 * surfaces depend on.
 *
 * The two delegation strike counters are independent at runtime —
 * `consecutiveBadRounds` increments only when EVERY verdict in a
 * round is bad (resets on any mixed/ok round), while
 * `perTaskBadStreak[key]` increments on per-task bad verdicts and
 * resets on a per-task `ok`. They catch complementary failure
 * patterns; a sibling-task succeeding hides a single failing task
 * from the round-level counter, but the per-task path catches it.
 *
 * The relationship MAX_PER_TASK_BAD_STREAK ≤ MAX_DELEGATION_BAD_ROUNDS
 * is the design invariant: in an all-bad delegation streak both
 * counters tick together, so per-task must never need MORE rounds
 * than round-level to halt. If a future tuning bump set
 * `MAX_PER_TASK_BAD_STREAK > MAX_DELEGATION_BAD_ROUNDS`, the per-task
 * surface would become dead weight in the all-bad case (the
 * round-level halt would always fire first AND the per-task hint in
 * `<run_state>.failing_tasks` would never have a chance to surface
 * before the run halted).
 *
 * Positivity invariants prevent a `0` literal from silently
 * disabling a counter.
 *
 * If THIS test fails on a constants change, either (a) the bump is
 * wrong, or (b) the design intent has shifted — update the comment
 * here and adjust the assertion intentionally.
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_DELEGATION_BAD_ROUNDS,
  MAX_FILES_PER_DELEGATE,
  MAX_PARALLEL_SUBAGENTS,
  MAX_PER_TASK_BAD_STREAK,
  MAX_SELF_CORRECTION_ATTEMPTS,
  MAX_TOTAL_ITERATIONS,
  SUBAGENT_MAX_ITERATIONS,
  SUBAGENT_WRAPUP_ITER
} from '@shared/constants';

describe('runtime limit invariants (H5)', () => {
  it('per-task strike must not require more rounds than round-level strike', () => {
    expect(MAX_PER_TASK_BAD_STREAK).toBeLessThanOrEqual(MAX_DELEGATION_BAD_ROUNDS);
  });

  it('every strike-related counter is a positive integer', () => {
    for (const [name, value] of Object.entries({
      MAX_DELEGATION_BAD_ROUNDS,
      MAX_PER_TASK_BAD_STREAK,
      MAX_SELF_CORRECTION_ATTEMPTS,
      MAX_TOTAL_ITERATIONS,
      MAX_PARALLEL_SUBAGENTS,
      MAX_FILES_PER_DELEGATE,
      SUBAGENT_MAX_ITERATIONS
    })) {
      expect(Number.isInteger(value), `${name} must be an integer`).toBe(true);
      expect(value, `${name} must be > 0`).toBeGreaterThan(0);
    }
  });

  it('SUBAGENT_WRAPUP_ITER sits at the penultimate iteration', () => {
    // Audit-defined contract: the wrap-up iteration is the LAST
    // before the cap, so `SUBAGENT_WRAPUP_ITER === SUBAGENT_MAX_ITERATIONS - 1`.
    expect(SUBAGENT_WRAPUP_ITER).toBe(SUBAGENT_MAX_ITERATIONS - 1);
  });

  it('MAX_TOTAL_ITERATIONS comfortably exceeds the strike thresholds', () => {
    // A run can't even reach the three-strike halt if its total
    // iteration cap is below the strike threshold. Defensive
    // structural check — guards against an inadvertent typo
    // (`MAX_TOTAL_ITERATIONS = 2` would silently mute every
    // strike surface).
    expect(MAX_TOTAL_ITERATIONS).toBeGreaterThan(MAX_DELEGATION_BAD_ROUNDS);
    expect(MAX_TOTAL_ITERATIONS).toBeGreaterThan(MAX_SELF_CORRECTION_ATTEMPTS);
  });

  it('MAX_FILES_PER_DELEGATE is reasonable for the harness file-list guidance', () => {
    // The harness asks the model to keep file lists minimal. The
    // cap exists to defend against pathological lists (review
    // finding H4). 32 was the audit's choice — sanity-check the
    // ballpark so a typo'd `0` or `1024` flips a test.
    expect(MAX_FILES_PER_DELEGATE).toBeGreaterThanOrEqual(8);
    expect(MAX_FILES_PER_DELEGATE).toBeLessThanOrEqual(128);
  });
});
