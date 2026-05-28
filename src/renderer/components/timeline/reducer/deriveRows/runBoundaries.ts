import type { TokenUsageAggregate } from '../types.js';

export type OpenRun = {
  promptId: string;
  promptTs: number;
  lastTs: number;
  editCount: number;
  filePaths: Set<string>;
  tokenBudgetWarnPct?: number;
  tokenBudgetWarnTokens?: number;
};
export type OpenRunUsage = {
  orchestrator?: TokenUsageAggregate;
  subagents: Record<string, TokenUsageAggregate>;
};

function combineRunUsage(openRunUsage: OpenRunUsage | null): TokenUsageAggregate | undefined {
  if (!openRunUsage) return undefined;
  const parts: TokenUsageAggregate[] = [];
  if (openRunUsage.orchestrator) parts.push(openRunUsage.orchestrator);
  for (const id of Object.keys(openRunUsage.subagents).sort()) {
    const usage = openRunUsage.subagents[id];
    if (usage) parts.push(usage);
  }
  if (parts.length === 0) return undefined;
  if (parts.length === 1) return parts[0];
  let latest = parts[0].latest;
  let peak = parts[0].peak;
  let cumulative = parts[0].cumulative;
  let samples = parts[0].samples;
  let streamStartedAt = parts[0].streamStartedAt;
  let streamEndedAt = parts[0].streamEndedAt;
  for (let i = 1; i < parts.length; i++) {
    const o = parts[i];
    latest = {
      promptTokens: latest.promptTokens + o.latest.promptTokens,
      completionTokens: latest.completionTokens + o.latest.completionTokens,
      totalTokens: latest.totalTokens + o.latest.totalTokens
    };
    cumulative = {
      promptTokens: cumulative.promptTokens + o.cumulative.promptTokens,
      completionTokens: cumulative.completionTokens + o.cumulative.completionTokens,
      totalTokens: cumulative.totalTokens + o.cumulative.totalTokens
    };
    peak = {
      promptTokens: Math.max(peak.promptTokens, o.peak.promptTokens),
      completionTokens: Math.max(peak.completionTokens, o.peak.completionTokens),
      totalTokens: Math.max(peak.totalTokens, o.peak.totalTokens)
    };
    samples += o.samples;
    if (typeof o.streamStartedAt === "number") {
      streamStartedAt =
        typeof streamStartedAt === "number"
          ? Math.min(streamStartedAt, o.streamStartedAt)
          : o.streamStartedAt;
    }
    if (typeof o.streamEndedAt === "number") {
      streamEndedAt =
        typeof streamEndedAt === "number"
          ? Math.max(streamEndedAt, o.streamEndedAt)
          : o.streamEndedAt;
    }
  }
  const out: TokenUsageAggregate = { latest, peak, cumulative, samples };
  if (typeof streamStartedAt === "number") out.streamStartedAt = streamStartedAt;
  if (typeof streamEndedAt === "number") out.streamEndedAt = streamEndedAt;
  return out;
}

export function flushRunToRows(
  out: import("../deriveRows.js").Row[],
  openRun: OpenRun | null,
  openRunUsage: OpenRunUsage | null,
  contextWindow?: number
): { openRun: OpenRun | null; openRunUsage: OpenRunUsage | null } {
  if (!openRun) return { openRun, openRunUsage };
  const durationMs = openRun.lastTs - openRun.promptTs;
  if (durationMs > 0) {
    if (openRun.tokenBudgetWarnPct !== undefined) {
      out.push({
        kind: 'token-budget-warning',
        key: `budget:${openRun.promptId}`,
        percent: openRun.tokenBudgetWarnPct,
        ...(openRun.tokenBudgetWarnTokens !== undefined
          ? { tokens: openRun.tokenBudgetWarnTokens }
          : {}),
        ...(contextWindow !== undefined ? { ceiling: contextWindow } : {})
      });
    }
    const usage = combineRunUsage(openRunUsage);
    const editCount = openRun.editCount;
    const fileCount = openRun.filePaths.size;
    out.push({
      kind: 'run-complete',
      key: `done:${openRun.promptId}`,
      durationMs,
      completedAt: openRun.lastTs,
      ...(usage !== undefined ? { usage } : {}),
      ...(editCount > 0 ? { editCount } : {}),
      ...(fileCount > 0 ? { fileCount } : {})
    });
  }
  return { openRun: null, openRunUsage: null };
}
