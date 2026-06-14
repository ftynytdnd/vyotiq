/**
 * Pure, shared context-window level math. Used by the main-process
 * ContextBudget service and the renderer's composer meter so both surfaces
 * agree on thresholds without duplicating logic.
 */

import type { ModelInfo } from '../types/provider.js';
import {
  CONTEXT_ABSOLUTE_COMPACTION_TRIGGER_TOKENS,
  CONTEXT_ABSOLUTE_COMPACTION_WARN_TOKENS,
  CONTEXT_HISTORY_COMPACTION_TRIGGER_TOKENS,
  CONTEXT_HISTORY_COMPACTION_WARN_TOKENS
} from '../constants.js';
import { effectiveContextWindow } from '../providers/contextWindow.js';

/** Severity of compaction pressure (warn / trigger / critical bands). */
export type ContextLevel = 'ok' | 'warn' | 'trigger' | 'critical';

export interface ContextLevelThresholds {
  /** Fraction of the model context window at which to warn (0..1). */
  warnFraction: number;
  /** Fraction of the model context window at which reduction triggers (0..1). */
  triggerFraction: number;
}

/** Normalize a discovered provider context window to a positive token count. */
export function resolveModelContextWindow(advertisedWindow: number): number {
  if (!Number.isFinite(advertisedWindow) || advertisedWindow <= 0) return 0;
  return Math.floor(advertisedWindow);
}

/** Resolve the advertised window for a model (with user overrides). */
export function resolveAdvertisedWindow(
  model: Pick<ModelInfo, 'id' | 'contextWindow'> | undefined,
  contextOverrides?: Record<string, number>
): number | undefined {
  if (!model) return undefined;
  return effectiveContextWindow(model, contextOverrides);
}

/**
 * Classify usage into a level from window fractions. Used by tests and legacy
 * callers; live compaction uses {@link classifyCompactionLevel}.
 */
export function classifyContextLevel(
  fractionUsed: number,
  thresholds: ContextLevelThresholds
): ContextLevel {
  const criticalFraction = Math.min(0.95, Math.max(thresholds.triggerFraction, 0.9));
  if (fractionUsed >= criticalFraction) return 'critical';
  if (fractionUsed >= thresholds.triggerFraction) return 'trigger';
  if (fractionUsed >= thresholds.warnFraction) return 'warn';
  return 'ok';
}

export interface CompactionTokenThresholds {
  warnTokens: number;
  triggerTokens: number;
}

/**
 * Resolve warn/trigger token bands for compaction: fraction of the discovered
 * window, capped by absolute constants so large models (e.g. 1M) still reduce
 * near ~200k while the meter shows fill against the full window.
 */
export function resolveCompactionThresholds(
  advertisedWindow: number,
  thresholds: ContextLevelThresholds
): CompactionTokenThresholds {
  const window = resolveModelContextWindow(advertisedWindow);
  if (window <= 0) return { warnTokens: 0, triggerTokens: 0 };
  const fractionWarn = Math.floor(window * thresholds.warnFraction);
  const fractionTrigger = Math.floor(window * thresholds.triggerFraction);
  return {
    warnTokens: Math.min(fractionWarn, CONTEXT_ABSOLUTE_COMPACTION_WARN_TOKENS),
    triggerTokens: Math.min(fractionTrigger, CONTEXT_ABSOLUTE_COMPACTION_TRIGGER_TOKENS)
  };
}

/** Classify compaction pressure from absolute token counts (not display %). */
export function classifyCompactionLevel(
  usedTokens: number,
  warnTokens: number,
  triggerTokens: number
): ContextLevel {
  if (triggerTokens <= 0) return 'ok';
  const criticalTokens = Math.floor(triggerTokens * 1.05);
  if (usedTokens >= criticalTokens) return 'critical';
  if (usedTokens >= triggerTokens) return 'trigger';
  if (warnTokens > 0 && usedTokens >= warnTokens) return 'warn';
  return 'ok';
}

const LEVEL_RANK: Record<ContextLevel, number> = {
  ok: 0,
  warn: 1,
  trigger: 2,
  critical: 3
};

function maxContextLevel(a: ContextLevel, b: ContextLevel): ContextLevel {
  return LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b;
}

/**
 * Bump compaction pressure when replayed history alone is large — common on
 * long tool-heavy runs against 1M-window models where total % stays low.
 */
export function applyHistoryCompactionPressure(
  level: ContextLevel,
  breakdown?: ContextUsageBreakdown
): ContextLevel {
  if (!breakdown) return level;
  const history = breakdown.history;
  if (history >= CONTEXT_HISTORY_COMPACTION_TRIGGER_TOKENS) {
    return maxContextLevel(level, 'trigger');
  }
  if (history >= CONTEXT_HISTORY_COMPACTION_WARN_TOKENS) {
    return maxContextLevel(level, 'warn');
  }
  return level;
}

/** Cushion above the host compaction trigger for Anthropic `clear_tool_uses`. */
export const ANTHROPIC_CLEAR_TOOL_TRIGGER_CUSHION_TOKENS = 8_192;

/** Offset below the host compaction trigger for server-side compaction backstop. */
export const ANTHROPIC_SERVER_COMPACTION_TRIGGER_OFFSET_TOKENS = 10_000;

/** Minimum Anthropic server-compaction trigger (API floor). */
export const ANTHROPIC_SERVER_COMPACTION_MIN_TRIGGER_TOKENS = 50_000;

/** Host `clear_tool_uses` trigger — just above the host compaction band. */
export function resolveAnthropicClearToolTriggerInputTokens(
  advertisedWindow: number,
  thresholds: ContextLevelThresholds
): number {
  const { triggerTokens } = resolveCompactionThresholds(advertisedWindow, thresholds);
  return triggerTokens + ANTHROPIC_CLEAR_TOOL_TRIGGER_CUSHION_TOKENS;
}

/** Server-side compaction trigger — below host clear, above API minimum. */
export function resolveAnthropicServerCompactionTriggerTokens(
  advertisedWindow: number,
  thresholds: ContextLevelThresholds
): number {
  const { triggerTokens } = resolveCompactionThresholds(advertisedWindow, thresholds);
  return Math.max(
    ANTHROPIC_SERVER_COMPACTION_MIN_TRIGGER_TOKENS,
    triggerTokens - ANTHROPIC_SERVER_COMPACTION_TRIGGER_OFFSET_TOKENS
  );
}

/**
 * Per-layer token breakdown for the cache-layered prompt topology. Matches the
 * slots built by `buildContextLayers` / `seedCacheLayeredMessages` plus the
 * tool-schema catalogue sent on the wire.
 */
export interface ContextUsageBreakdown {
  /** Harness + meta-rules (`messages[0]` system slot). */
  system: number;
  /** Static few-shot examples (`messages[1]`). */
  fewShot: number;
  /** Workspace listing envelope (`messages[2]`). */
  workspace: number;
  /** Replayed transcript rows between workspace and the runtime tail. */
  history: number;
  /** Runtime tail — host env, session, run state, memory, pressure, goal. */
  runtime: number;
  /** Current turn envelope — user message, mentions, attachments. */
  turn: number;
  /** Serialized tool schemas attached to the request. */
  tools: number;
}

export const EMPTY_CONTEXT_BREAKDOWN: ContextUsageBreakdown = {
  system: 0,
  fewShot: 0,
  workspace: 0,
  history: 0,
  runtime: 0,
  turn: 0,
  tools: 0
};

/** Sum every layer in a breakdown (equals total prompt tokens when complete). */
export function sumContextBreakdown(b: ContextUsageBreakdown): number {
  return (
    b.system +
    b.fewShot +
    b.workspace +
    b.history +
    b.runtime +
    b.turn +
    b.tools
  );
}

/** Scale each breakdown layer so the sum matches `target` tokens. */
export function scaleContextBreakdown(
  breakdown: ContextUsageBreakdown,
  baseTotal: number,
  targetTotal: number
): ContextUsageBreakdown {
  if (baseTotal <= 0 || targetTotal <= 0) return breakdown;
  const f = targetTotal / baseTotal;
  const scaled: ContextUsageBreakdown = {
    system: Math.round(breakdown.system * f),
    fewShot: Math.round(breakdown.fewShot * f),
    workspace: Math.round(breakdown.workspace * f),
    history: Math.round(breakdown.history * f),
    runtime: Math.round(breakdown.runtime * f),
    turn: Math.round(breakdown.turn * f),
    tools: Math.round(breakdown.tools * f)
  };
  return reconcileContextBreakdown(scaled, targetTotal);
}

const BREAKDOWN_KEYS: (keyof ContextUsageBreakdown)[] = [
  'system',
  'fewShot',
  'workspace',
  'history',
  'runtime',
  'turn',
  'tools'
];

/**
 * Fix per-layer rounding drift so `sumContextBreakdown` equals `targetTotal`.
 * Adjusts the largest non-zero layer (or `system` when all are zero).
 */
export function reconcileContextBreakdown(
  breakdown: ContextUsageBreakdown,
  targetTotal: number
): ContextUsageBreakdown {
  const sum = sumContextBreakdown(breakdown);
  const delta = targetTotal - sum;
  if (delta === 0) return breakdown;

  let absorbKey: keyof ContextUsageBreakdown = 'system';
  let absorbVal = breakdown.system;
  for (const key of BREAKDOWN_KEYS) {
    if (breakdown[key] > absorbVal) {
      absorbVal = breakdown[key];
      absorbKey = key;
    }
  }

  return {
    ...breakdown,
    [absorbKey]: Math.max(0, breakdown[absorbKey] + delta)
  };
}

export interface ContextUsageSummary {
  usedTokens: number;
  /** Provider-discovered (or user-overridden) model context window. */
  advertisedWindow: number;
  /**
   * Same as `advertisedWindow` — retained for timeline replay compatibility.
   */
  effectiveWindow: number;
  /** usedTokens / effectiveWindow — display % only (full discovered window). */
  fractionUsed: number;
  /** Compaction pressure band (absolute/fraction thresholds, not display %). */
  level: ContextLevel;
  /** True when usedTokens came from an exact tokenizer (not the heuristic). */
  exact: boolean;
  /**
   * Per-layer token breakdown for the composer meter. Absent only when the
   * caller truly has no layer visibility (should be rare).
   */
  breakdown?: ContextUsageBreakdown;
}

/** Build a full usage summary from raw inputs. */
export function summarizeContextUsage(opts: {
  usedTokens: number;
  advertisedWindow: number;
  thresholds: ContextLevelThresholds;
  exact: boolean;
  breakdown?: ContextUsageBreakdown;
}): ContextUsageSummary {
  const effectiveWindow = resolveModelContextWindow(opts.advertisedWindow);
  const fractionUsed =
    effectiveWindow > 0 ? opts.usedTokens / effectiveWindow : 0;
  const { warnTokens, triggerTokens } = resolveCompactionThresholds(
    opts.advertisedWindow,
    opts.thresholds
  );
  const baseLevel = classifyCompactionLevel(opts.usedTokens, warnTokens, triggerTokens);
  return {
    usedTokens: opts.usedTokens,
    advertisedWindow: effectiveWindow,
    effectiveWindow,
    fractionUsed,
    level: applyHistoryCompactionPressure(baseLevel, opts.breakdown),
    exact: opts.exact,
    ...(opts.breakdown ? { breakdown: opts.breakdown } : {})
  };
}
