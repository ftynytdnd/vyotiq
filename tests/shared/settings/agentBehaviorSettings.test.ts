import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RUN_TOKEN_BUDGET_MAX,
  DEFAULT_RUN_WALL_CLOCK_BUDGET_MS,
  isRunTokenBudgetExceeded,
  isRunWallClockBudgetExceeded,
  resolveAgentBehaviorSettings
} from '@shared/settings/agentBehaviorSettings';

describe('resolveAgentBehaviorSettings', () => {
  it('defaults token budget off and compaction off', () => {
    const resolved = resolveAgentBehaviorSettings();
    expect(resolved.runTokenBudget.enabled).toBe(false);
    expect(resolved.runTokenBudget.maxTotalTokens).toBe(DEFAULT_RUN_TOKEN_BUDGET_MAX);
    expect(resolved.contextCompaction.enabled).toBe(false);
    expect(resolved.runWallClockBudget.enabled).toBe(false);
  });

  it('clamps maxTotalTokens into allowed range', () => {
    const resolved = resolveAgentBehaviorSettings({
      agentBehavior: { runTokenBudget: { maxTotalTokens: 100 } }
    });
    expect(resolved.runTokenBudget.maxTotalTokens).toBe(10_000);
  });

  it('isRunTokenBudgetExceeded respects enabled flag', () => {
    const off = resolveAgentBehaviorSettings();
    expect(isRunTokenBudgetExceeded(9_999_999, off)).toBe(false);

    const on = resolveAgentBehaviorSettings({
      agentBehavior: { runTokenBudget: { enabled: true, maxTotalTokens: 50_000 } }
    });
    expect(isRunTokenBudgetExceeded(50_001, on)).toBe(true);
    expect(isRunTokenBudgetExceeded(50_000, on)).toBe(false);
  });

  it('clamps maxDurationMs into allowed range', () => {
    const tooLow = resolveAgentBehaviorSettings({
      agentBehavior: { runWallClockBudget: { maxDurationMs: 1_000 } }
    });
    expect(tooLow.runWallClockBudget.maxDurationMs).toBe(60_000);

    const tooHigh = resolveAgentBehaviorSettings({
      agentBehavior: { runWallClockBudget: { maxDurationMs: 999 * 60 * 60 * 1000 } }
    });
    expect(tooHigh.runWallClockBudget.maxDurationMs).toBe(24 * 60 * 60 * 1000);

    const unset = resolveAgentBehaviorSettings();
    expect(unset.runWallClockBudget.maxDurationMs).toBe(DEFAULT_RUN_WALL_CLOCK_BUDGET_MS);
  });

  it('isRunWallClockBudgetExceeded respects enabled flag', () => {
    const off = resolveAgentBehaviorSettings();
    expect(isRunWallClockBudgetExceeded(Number.MAX_SAFE_INTEGER, off)).toBe(false);

    const on = resolveAgentBehaviorSettings({
      agentBehavior: { runWallClockBudget: { enabled: true, maxDurationMs: 120_000 } }
    });
    expect(isRunWallClockBudgetExceeded(120_001, on)).toBe(true);
    expect(isRunWallClockBudgetExceeded(120_000, on)).toBe(false);
  });
});
