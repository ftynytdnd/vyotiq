/**
 * Resolved defaults for `settings.ui.agentBehavior` — run limits and
 * long-task context options.
 */

import type { AppSettings } from '../types/ipc.js';
import { DEFAULT_RUN_WALL_CLOCK_BUDGET_MS } from '../constants.js';

/** Default cumulative token ceiling when the per-run budget is enabled. */
export const DEFAULT_RUN_TOKEN_BUDGET_MAX = 1_000_000;
export { DEFAULT_RUN_WALL_CLOCK_BUDGET_MS };

export interface RunTokenBudgetSettings {
  /** When true, halt the run after cumulative `totalTokens` exceeds `maxTotalTokens`. */
  enabled: boolean;
  /** Inclusive ceiling on summed provider `usage.totalTokens` for the run. */
  maxTotalTokens: number;
}

export interface RunWallClockBudgetSettings {
  /** When true, halt the run after `maxDurationMs` of wall-clock time. */
  enabled: boolean;
  /** Maximum run duration in milliseconds. */
  maxDurationMs: number;
}

export interface ContextCompactionSettings {
  /**
   * Reversible context compaction (see `docs/context-compaction-design.md`).
   * When false (default), the host passes the full transcript to the provider.
   */
  enabled: boolean;
}

export interface AgentBehaviorSettings {
  runTokenBudget: RunTokenBudgetSettings;
  runWallClockBudget: RunWallClockBudgetSettings;
  contextCompaction: ContextCompactionSettings;
}

export const DEFAULT_AGENT_BEHAVIOR_SETTINGS: AgentBehaviorSettings = {
  runTokenBudget: {
    enabled: false,
    maxTotalTokens: DEFAULT_RUN_TOKEN_BUDGET_MAX
  },
  runWallClockBudget: {
    enabled: false,
    maxDurationMs: DEFAULT_RUN_WALL_CLOCK_BUDGET_MS
  },
  contextCompaction: {
    enabled: false
  }
} as const;

export type ResolvedAgentBehaviorSettings = AgentBehaviorSettings;

function clampTokenBudgetMax(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_RUN_TOKEN_BUDGET_MAX;
  }
  const rounded = Math.round(value);
  if (rounded < 10_000) return 10_000;
  if (rounded > 50_000_000) return 50_000_000;
  return rounded;
}

function clampWallClockBudgetMs(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_RUN_WALL_CLOCK_BUDGET_MS;
  }
  const rounded = Math.round(value);
  if (rounded < 60_000) return 60_000;
  if (rounded > 24 * 60 * 60 * 1000) return 24 * 60 * 60 * 1000;
  return rounded;
}

export function resolveAgentBehaviorSettings(
  ui?: AppSettings['ui']
): ResolvedAgentBehaviorSettings {
  const a = ui?.agentBehavior;
  return {
    runTokenBudget: {
      enabled: a?.runTokenBudget?.enabled === true,
      maxTotalTokens: clampTokenBudgetMax(a?.runTokenBudget?.maxTotalTokens)
    },
    runWallClockBudget: {
      enabled: a?.runWallClockBudget?.enabled === true,
      maxDurationMs: clampWallClockBudgetMs(a?.runWallClockBudget?.maxDurationMs)
    },
    contextCompaction: {
      enabled: a?.contextCompaction?.enabled === true
    }
  };
}

/** True when cumulative run tokens exceed the configured budget. */
export function isRunTokenBudgetExceeded(
  cumulativeTotalTokens: number,
  settings: ResolvedAgentBehaviorSettings
): boolean {
  if (!settings.runTokenBudget.enabled) return false;
  return cumulativeTotalTokens > settings.runTokenBudget.maxTotalTokens;
}

/** True when elapsed wall-clock time exceeds the configured budget. */
export function isRunWallClockBudgetExceeded(
  elapsedMs: number,
  settings: ResolvedAgentBehaviorSettings
): boolean {
  if (!settings.runWallClockBudget.enabled) return false;
  return elapsedMs > settings.runWallClockBudget.maxDurationMs;
}
