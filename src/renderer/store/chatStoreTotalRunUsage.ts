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
  let fp = orc
    ? `O:${fingerprintTokenUsage(orc.latest)}|F:${fingerprintTokenUsage(orc.inFlight)}|S:${orc.samples}`
    : 'O:_';
  const ids = Object.keys(slice.subagents);
  if (ids.length === 0) return fp;
  ids.sort();
  for (const id of ids) {
    const sa = slice.subagents[id];
    if (!sa?.usage) continue;
    fp += `||${id}:${fingerprintTokenUsage(sa.usage.latest)}/${fingerprintTokenUsage(sa.usage.inFlight)}/${sa.usage.samples}`;
  }
  return fp;
}

function sumTokenUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  const out: TokenUsage = {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens
  };
  const cached = sumOpt(a.cachedPromptTokens, b.cachedPromptTokens);
  if (cached !== undefined) out.cachedPromptTokens = cached;
  const cacheCreation = sumOpt(a.cacheCreationTokens, b.cacheCreationTokens);
  if (cacheCreation !== undefined) out.cacheCreationTokens = cacheCreation;
  const reasoning = sumOpt(a.reasoningTokens, b.reasoningTokens);
  if (reasoning !== undefined) out.reasoningTokens = reasoning;
  return out;
}

function maxOpt(a: number | undefined, b: number | undefined): number | undefined {
  if (typeof a === 'number' && typeof b === 'number') return Math.max(a, b);
  if (typeof a === 'number') return a;
  if (typeof b === 'number') return b;
  return undefined;
}

function sumOpt(a: number | undefined, b: number | undefined): number | undefined {
  if (typeof a === 'number' && typeof b === 'number') return a + b;
  if (typeof a === 'number') return a;
  if (typeof b === 'number') return b;
  return undefined;
}

export function computeTotalRunUsage(slice: ChatSlice): TokenUsageAggregate | undefined {
  const fp = makeUsageFingerprint(slice);
  if (fp === cachedTotalRunUsageFingerprint) {
    return cachedTotalRunUsageResult;
  }

  const owners: TokenUsageAggregate[] = [];
  if (slice.orchestratorUsage) owners.push(slice.orchestratorUsage);
  const ids = Object.keys(slice.subagents).sort();
  for (const id of ids) {
    const sa = slice.subagents[id];
    if (sa?.usage) owners.push(sa.usage);
  }
  if (owners.length === 0) {
    cachedTotalRunUsageFingerprint = fp;
    cachedTotalRunUsageResult = undefined;
    return undefined;
  }

  let latest = owners[0]!.latest;
  let peak = owners[0]!.peak;
  let cumulative = owners[0]!.cumulative;
  let samples = owners[0]!.samples;
  let inFlightCompletionTokens = owners[0]!.inFlight?.completionTokens ?? 0;
  let streamStartedAt = owners[0]!.streamStartedAt;
  let streamEndedAt = owners[0]!.streamEndedAt;
  for (let i = 1; i < owners.length; i++) {
    const o = owners[i]!;
    latest = sumTokenUsage(latest, o.latest);
    cumulative = sumTokenUsage(cumulative, o.cumulative);
    const nextPeak: TokenUsage = {
      promptTokens: Math.max(peak.promptTokens, o.peak.promptTokens),
      completionTokens: Math.max(peak.completionTokens, o.peak.completionTokens),
      totalTokens: Math.max(peak.totalTokens, o.peak.totalTokens)
    };
    const cached = maxOpt(peak.cachedPromptTokens, o.peak.cachedPromptTokens);
    if (cached !== undefined) nextPeak.cachedPromptTokens = cached;
    const cacheCreation = maxOpt(peak.cacheCreationTokens, o.peak.cacheCreationTokens);
    if (cacheCreation !== undefined) nextPeak.cacheCreationTokens = cacheCreation;
    const reasoning = maxOpt(peak.reasoningTokens, o.peak.reasoningTokens);
    if (reasoning !== undefined) nextPeak.reasoningTokens = reasoning;
    peak = nextPeak;
    samples += o.samples;
    inFlightCompletionTokens += o.inFlight?.completionTokens ?? 0;
    if (typeof o.streamStartedAt === 'number') {
      streamStartedAt =
        typeof streamStartedAt === 'number'
          ? Math.min(streamStartedAt, o.streamStartedAt)
          : o.streamStartedAt;
    }
    if (typeof o.streamEndedAt === 'number') {
      streamEndedAt =
        typeof streamEndedAt === 'number'
          ? Math.max(streamEndedAt, o.streamEndedAt)
          : o.streamEndedAt;
    }
  }

  const totalRunUsage: TokenUsageAggregate = {
    latest,
    peak,
    cumulative,
    samples
  };
  if (inFlightCompletionTokens > 0) {
    totalRunUsage.inFlight = {
      promptTokens: 0,
      completionTokens: inFlightCompletionTokens,
      totalTokens: inFlightCompletionTokens
    };
  }
  if (typeof streamStartedAt === 'number') {
    totalRunUsage.streamStartedAt = streamStartedAt;
  }
  if (typeof streamEndedAt === 'number') {
    totalRunUsage.streamEndedAt = streamEndedAt;
  }
  cachedTotalRunUsageFingerprint = fp;
  cachedTotalRunUsageResult = totalRunUsage;
  return totalRunUsage;
}

/** Test-only — clears the totalRunUsage memoizer between cases. */
export function __resetTotalRunUsageCacheForTests(): void {
  cachedTotalRunUsageFingerprint = '__INIT__';
  cachedTotalRunUsageResult = undefined;
}
