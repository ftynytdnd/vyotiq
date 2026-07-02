import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RUN_TOKEN_BUDGET_MAX,
  DEFAULT_RUN_WALL_CLOCK_BUDGET_MS,
  isRunTokenBudgetExceeded,
  isRunWallClockBudgetExceeded,
  resolveAgentBehaviorSettings,
  resolveMaxTotalIterations
} from '@shared/settings/agentBehaviorSettings';
import { DEFAULT_MAX_TOTAL_ITERATIONS } from '@shared/constants';

describe('resolveAgentBehaviorSettings', () => {
  it('defaults token budget off and context management on', () => {
    const resolved = resolveAgentBehaviorSettings();
    expect(resolved.runTokenBudget.enabled).toBe(false);
    expect(resolved.runTokenBudget.maxTotalTokens).toBe(DEFAULT_RUN_TOKEN_BUDGET_MAX);
    expect(resolved.contextManagement.enabled).toBe(true);
    expect(resolved.runWallClockBudget.enabled).toBe(false);
    expect(resolveMaxTotalIterations(resolved)).toBe(DEFAULT_MAX_TOTAL_ITERATIONS);
  });

  it('clamps run iteration limit', () => {
    const low = resolveAgentBehaviorSettings({
      agentBehavior: { runIterationLimit: { maxTotalIterations: 3 } }
    });
    expect(resolveMaxTotalIterations(low)).toBe(8);
    const high = resolveAgentBehaviorSettings({
      agentBehavior: { runIterationLimit: { maxTotalIterations: 999 } }
    });
    expect(resolveMaxTotalIterations(high)).toBe(200);
    const custom = resolveAgentBehaviorSettings({
      agentBehavior: { runIterationLimit: { maxTotalIterations: 93 } }
    });
    expect(resolveMaxTotalIterations(custom)).toBe(93);
  });

  it('context management: defaults, legacy fallback, and fraction clamps', () => {
    const def = resolveAgentBehaviorSettings();
    expect(def.contextManagement.triggerFraction).toBe(0.75);
    expect(def.contextManagement.warnFraction).toBe(0.7);
    expect(def.contextManagement.keepLastToolResults).toBe(3);

    // Legacy `contextCompaction.enabled` seeds the master switch when the
    // new object is absent.
    const legacyOff = resolveAgentBehaviorSettings({
      agentBehavior: { contextCompaction: { enabled: false } }
    });
    expect(legacyOff.contextManagement.enabled).toBe(false);

    // New object wins over the legacy flag.
    const both = resolveAgentBehaviorSettings({
      agentBehavior: {
        contextCompaction: { enabled: false },
        contextManagement: { enabled: true }
      }
    });
    expect(both.contextManagement.enabled).toBe(true);

    // warnFraction is forced below triggerFraction.
    const clamped = resolveAgentBehaviorSettings({
      agentBehavior: {
        contextManagement: { triggerFraction: 0.6, warnFraction: 0.9 }
      }
    });
    expect(clamped.contextManagement.triggerFraction).toBe(0.6);
    expect(clamped.contextManagement.warnFraction).toBeLessThan(0.6);
  });

  it('context management: advanced knobs (summary model, server compaction)', () => {
    const def = resolveAgentBehaviorSettings();
    expect(def.contextManagement.summaryModel).toBeNull();
    expect(def.contextManagement.serverSideCompaction).toBe(false);
    const partial = resolveAgentBehaviorSettings({
      agentBehavior: { contextManagement: { summaryModel: { providerId: 'anthropic', modelId: '' } } }
    });
    expect(partial.contextManagement.summaryModel).toBeNull();

    const full = resolveAgentBehaviorSettings({
      agentBehavior: {
        contextManagement: { summaryModel: { providerId: 'anthropic', modelId: 'claude-haiku' } }
      }
    });
    expect(full.contextManagement.summaryModel).toEqual({
      providerId: 'anthropic',
      modelId: 'claude-haiku'
    });

    const compactOn = resolveAgentBehaviorSettings({
      agentBehavior: { contextManagement: { serverSideCompaction: true } }
    });
    expect(compactOn.contextManagement.serverSideCompaction).toBe(true);
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
