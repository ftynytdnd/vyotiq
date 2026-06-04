/**
 * Run-level token-usage aggregation for the active chat mirror.
 *
 * Memoized behind a structural fingerprint so selectors keyed on
 * `totalRunUsage` skip re-renders when usage-relevant fields are
 * unchanged (common for text/args deltas).
 */

import type { TokenUsage } from '@shared/types/chat.js';
import type { TokenUsageAggregate } from '../components/timeline/reducer/types.js';
import type { ChatSlice } from './chatStoreTypes.js';

let cachedTotalRunUsageFingerprint = '__INIT__';
let cachedTotalRunUsageResult: TokenUsageAggregate | undefined;

function fingerprintTokenUsage(u: TokenUsage | undefined): string {
  if (!u) return '_';
  return `${u.totalTokens ?? 0}/${u.promptTokens ?? 0}/${u.completionTokens ?? 0}`;
}

function makeUsageFingerprint(slice: ChatSlice): string {
  const orc = slice.orchestratorUsage;
  return orc
    ? `O:${fingerprintTokenUsage(orc.latest)}|F:${fingerprintTokenUsage(orc.inFlight)}|S:${orc.samples}`
    : 'O:_';
}

export function computeTotalRunUsage(slice: ChatSlice): TokenUsageAggregate | undefined {
  const fp = makeUsageFingerprint(slice);
  if (fp === cachedTotalRunUsageFingerprint) {
    return cachedTotalRunUsageResult;
  }

  const usage = slice.orchestratorUsage;
  cachedTotalRunUsageFingerprint = fp;
  cachedTotalRunUsageResult = usage;
  return usage;
}

/** Test-only — clears the totalRunUsage memoizer between cases. */
export function __resetTotalRunUsageCacheForTests(): void {
  cachedTotalRunUsageFingerprint = '__INIT__';
  cachedTotalRunUsageResult = undefined;
}
