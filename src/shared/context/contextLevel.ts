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
   * Optional per-segment token breakdown (system prefix / history / tool
   * schemas) for the composer meter tooltip. Absent on derived/at-rest paths
   * that only know the total.
   */
  byPart?: { systemPrompt: number; history: number; tools: number };
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
  byPart?: { systemPrompt: number; history: number; tools: number };
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
    ...(opts.byPart ? { byPart: opts.byPart } : {})
  };
}
