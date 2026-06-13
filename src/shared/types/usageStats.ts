/**
 * Per-turn and cumulative usage statistics for cost/cache tracking.
 */

/** Delta recorded once per completed agent turn. */
export interface TurnUsageStatsDelta {
  netCacheSavingsUsd?: number;
  cachedTokens?: number;
  reasoningTokens?: number;
  /** Last turn cache hit percentage (0–100). */
  lastCacheHitPct?: number;
}

/** Persisted conversation-level usage aggregates. */
export interface ConversationUsageStats {
  runCount?: number;
  cumulativeCachedTokens?: number;
  cumulativeReasoningTokens?: number;
  cumulativeCacheSavingsUsd?: number;
  lastCacheHitPct?: number;
}

/** Workspace-level usage aggregates (persisted in settings.ui). */
export interface WorkspaceSpendStats {
  spendUsd: number;
  cacheSavingsUsd: number;
  cachedTokens: number;
  reasoningTokens: number;
  runCount: number;
}

/** Ephemeral app-session totals (renderer only; reset on quit). */
export interface AppSessionStats {
  spendUsd: number;
  cacheSavingsUsd: number;
  cachedTokens: number;
  reasoningTokens: number;
  runCount: number;
}

export const EMPTY_WORKSPACE_SPEND_STATS: WorkspaceSpendStats = {
  spendUsd: 0,
  cacheSavingsUsd: 0,
  cachedTokens: 0,
  reasoningTokens: 0,
  runCount: 0
};

export const EMPTY_APP_SESSION_STATS: AppSessionStats = {
  spendUsd: 0,
  cacheSavingsUsd: 0,
  cachedTokens: 0,
  reasoningTokens: 0,
  runCount: 0
};

export type WorkspaceSpendEntry = number | WorkspaceSpendStats;

/** Normalize legacy numeric workspace spend to a full stats struct. */
export function normalizeWorkspaceSpendEntry(
  value: WorkspaceSpendEntry | WorkspaceSpendStats | undefined
): WorkspaceSpendStats {
  if (value === undefined) return { ...EMPTY_WORKSPACE_SPEND_STATS };
  if (typeof value === 'number') {
    return { ...EMPTY_WORKSPACE_SPEND_STATS, spendUsd: value };
  }
  return {
    spendUsd: value.spendUsd ?? 0,
    cacheSavingsUsd: value.cacheSavingsUsd ?? 0,
    cachedTokens: value.cachedTokens ?? 0,
    reasoningTokens: value.reasoningTokens ?? 0,
    runCount: value.runCount ?? 0
  };
}

/** Merge a turn delta into workspace stats. */
export function mergeWorkspaceSpendStats(
  base: WorkspaceSpendStats,
  usd: number,
  delta: TurnUsageStatsDelta = {}
): WorkspaceSpendStats {
  return {
    spendUsd: base.spendUsd + usd,
    cacheSavingsUsd: base.cacheSavingsUsd + (delta.netCacheSavingsUsd ?? 0),
    cachedTokens: base.cachedTokens + (delta.cachedTokens ?? 0),
    reasoningTokens: base.reasoningTokens + (delta.reasoningTokens ?? 0),
    runCount: base.runCount + 1
  };
}

/** Merge a turn delta into app-session stats. */
export function mergeAppSessionStats(
  base: AppSessionStats,
  usd: number,
  delta: TurnUsageStatsDelta = {}
): AppSessionStats {
  return mergeWorkspaceSpendStats(base, usd, delta);
}
