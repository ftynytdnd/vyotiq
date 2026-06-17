/**
 * Ephemeral app-session usage totals (reset on app quit).
 */

import { create } from 'zustand';
import {
  EMPTY_APP_SESSION_STATS,
  mergeAppSessionStats,
  type AppSessionStats,
  type TurnUsageStatsDelta
} from '@shared/types/usageStats.js';

interface SessionStatsState {
  stats: AppSessionStats;
  recordTurn: (usd: number, delta?: TurnUsageStatsDelta) => void;
}

export const useSessionStatsStore = create<SessionStatsState>((set) => ({
  stats: { ...EMPTY_APP_SESSION_STATS },
  recordTurn: (usd, delta = {}) => {
    if (!Number.isFinite(usd) || usd <= 0) return;
    set((s) => ({ stats: mergeAppSessionStats(s.stats, usd, delta) }));
  }
}));
