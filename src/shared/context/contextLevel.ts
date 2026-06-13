/**
 * Pure, shared context-window level math. Used by the main-process
 * ContextBudget service and the renderer's composer meter so both surfaces
 * agree on thresholds without duplicating logic.
 */

import type { ModelInfo } from '../types/provider.js';
import { effectiveContextWindow } from '../providers/contextWindow.js';

/** Severity of current context usage relative to the effective window. */
export type ContextLevel = 'ok' | 'warn' | 'trigger' | 'critical';

export interface ContextLevelThresholds {
  /** Fraction of the effective window at which to warn (0..1). */
  warnFraction: number;
  /** Fraction of the effective window at which reduction triggers (0..1). */
  triggerFraction: number;
}

/**
 * Usable window = `min(advertised × effectiveWindowFraction, absoluteCeiling)`.
 *
 * Advertised windows overstate the length over which a model reasons reliably,
 * so we first take a fraction of them. 2026 context-rot research further shows
 * degradation onset is roughly *absolute* (tens of thousands of tokens) rather
 * than proportional, so for very large windows a flat fraction still lands far
 * past the rot curve. The optional `absoluteCeilingTokens` caps the usable
 * window at a fixed token bound (pass `0`/omit to disable the cap).
 */
export function computeEffectiveWindow(
  advertisedWindow: number,
  effectiveWindowFraction: number,
  absoluteCeilingTokens = 0
): number {
  if (!Number.isFinite(advertisedWindow) || advertisedWindow <= 0) return 0;
  const frac =
    Number.isFinite(effectiveWindowFraction) && effectiveWindowFraction > 0
      ? Math.min(effectiveWindowFraction, 1)
      : 1;
  let usable = Math.floor(advertisedWindow * frac);
  if (
    Number.isFinite(absoluteCeilingTokens) &&
    absoluteCeilingTokens > 0 &&
    usable > absoluteCeilingTokens
  ) {
    usable = Math.floor(absoluteCeilingTokens);
  }
  return usable;
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
 * Classify usage into a level. `criticalFraction` (>= trigger) marks the
 * zone where context rot is acute even after reduction has run.
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
  advertisedWindow: number;
  effectiveWindow: number;
  /** usedTokens / effectiveWindow, clamped to [0, 1+] (can exceed 1 when over). */
  fractionUsed: number;
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
  effectiveWindowFraction: number;
  thresholds: ContextLevelThresholds;
  exact: boolean;
  /** Adaptive absolute cap on the usable window (tokens); 0/omitted disables it. */
  absoluteCeilingTokens?: number;
  breakdown?: ContextUsageBreakdown;
}): ContextUsageSummary {
  const effectiveWindow = computeEffectiveWindow(
    opts.advertisedWindow,
    opts.effectiveWindowFraction,
    opts.absoluteCeilingTokens ?? 0
  );
  const fractionUsed =
    effectiveWindow > 0 ? opts.usedTokens / effectiveWindow : 0;
  return {
    usedTokens: opts.usedTokens,
    advertisedWindow: opts.advertisedWindow,
    effectiveWindow,
    fractionUsed,
    level:
      effectiveWindow > 0
        ? classifyContextLevel(fractionUsed, opts.thresholds)
        : 'ok',
    exact: opts.exact,
    ...(opts.breakdown ? { breakdown: opts.breakdown } : {})
  };
}
