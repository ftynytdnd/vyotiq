/**
 * Resolved defaults for `settings.ui.agentBehavior` — run limits and
 * long-task context options.
 */

import type { AppSettings } from '../types/ipc.js';
import {
  CONTEXT_DEFAULT_ABSOLUTE_CEILING_TOKENS,
  CONTEXT_DEFAULT_COOLDOWN_MS,
  CONTEXT_DEFAULT_EFFECTIVE_WINDOW_FRACTION,
  CONTEXT_DEFAULT_KEEP_LAST_TOOL_RESULTS,
  CONTEXT_DEFAULT_MIN_SAVINGS_TOKENS,
  CONTEXT_DEFAULT_TRIGGER_FRACTION,
  CONTEXT_DEFAULT_WARN_FRACTION,
  DEFAULT_RUN_WALL_CLOCK_BUDGET_MS
} from '../constants.js';

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

/**
 * Unified context-window management (see `docs/context-management-design.md`).
 * On by default: the host proactively keeps the prompt under a fraction of the
 * model's *effective* window via reversible reduction (tool-result clearing →
 * on-disk offload → reversible structured summarization).
 */
export interface ContextManagementSettings {
  /** Master switch. When false, the host passes the full transcript to the provider. */
  enabled: boolean;
  /** Fraction of the effective window at which automatic reduction triggers (0..1). */
  triggerFraction: number;
  /** Fraction of the effective window at which the UI shows an early warning (0..1). */
  warnFraction: number;
  /** Usable share of the model's advertised window (0..1) — combats context rot. */
  effectiveWindowFraction: number;
  /** Most-recent tool results kept verbatim when clearing older ones. */
  keepLastToolResults: number;
  /** Allow lossy structured summarization as a last resort when reversible levers fall short. */
  summarizationEnabled: boolean;
  /** Cooldown between automatic reduction passes for one run (anti-thrash, ms). */
  cooldownMs: number;
  /** Minimum tokens a reduction pass must free, else it is skipped (protects prompt cache). */
  minSavingsTokens: number;
  /**
   * Adaptive absolute ceiling on the usable window (tokens). The effective
   * window is capped at `min(advertised × effectiveWindowFraction, this)`.
   * `0` disables the cap (pure fractional behavior).
   */
  absoluteCeilingTokens: number;
  /**
   * Optional dedicated model for lossy summarization. `null` ⇒ summarize with
   * the run's own model.
   */
  summaryModel: { providerId: string; modelId: string } | null;
  /** Opt-in Anthropic server-side `compact_20260112` backstop (Anthropic dialect only). */
  serverSideCompaction: boolean;
}

export interface AgentBehaviorSettings {
  runTokenBudget: RunTokenBudgetSettings;
  runWallClockBudget: RunWallClockBudgetSettings;
  contextManagement: ContextManagementSettings;
}

export const DEFAULT_CONTEXT_MANAGEMENT_SETTINGS: ContextManagementSettings = {
  enabled: true,
  triggerFraction: CONTEXT_DEFAULT_TRIGGER_FRACTION,
  warnFraction: CONTEXT_DEFAULT_WARN_FRACTION,
  effectiveWindowFraction: CONTEXT_DEFAULT_EFFECTIVE_WINDOW_FRACTION,
  keepLastToolResults: CONTEXT_DEFAULT_KEEP_LAST_TOOL_RESULTS,
  summarizationEnabled: true,
  cooldownMs: CONTEXT_DEFAULT_COOLDOWN_MS,
  minSavingsTokens: CONTEXT_DEFAULT_MIN_SAVINGS_TOKENS,
  absoluteCeilingTokens: CONTEXT_DEFAULT_ABSOLUTE_CEILING_TOKENS,
  summaryModel: null,
  serverSideCompaction: false
} as const;

export const DEFAULT_AGENT_BEHAVIOR_SETTINGS: AgentBehaviorSettings = {
  runTokenBudget: {
    enabled: false,
    maxTotalTokens: DEFAULT_RUN_TOKEN_BUDGET_MAX
  },
  runWallClockBudget: {
    enabled: false,
    maxDurationMs: DEFAULT_RUN_WALL_CLOCK_BUDGET_MS
  },
  contextManagement: DEFAULT_CONTEXT_MANAGEMENT_SETTINGS
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

/** Clamp a 0..1 fraction with a fallback, bounded to a safe sub-range. */
function clampFraction(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const rounded = Math.round(value);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
}

/**
 * Resolve context-management settings, preferring the new `contextManagement`
 * object and falling back to the legacy `contextCompaction.enabled` flag (older
 * persisted settings) for the master switch only.
 */
type AgentBehaviorUi = NonNullable<NonNullable<AppSettings['ui']>['agentBehavior']>;

function resolveContextManagement(a?: AgentBehaviorUi): ContextManagementSettings {
  const cm = a?.contextManagement;
  const legacyEnabled = a?.contextCompaction?.enabled;
  const d = DEFAULT_CONTEXT_MANAGEMENT_SETTINGS;
  const enabled =
    typeof cm?.enabled === 'boolean'
      ? cm.enabled
      : typeof legacyEnabled === 'boolean'
        ? legacyEnabled
        : d.enabled;
  // warnFraction must stay below triggerFraction; trigger below 1.
  const triggerFraction = clampFraction(cm?.triggerFraction, d.triggerFraction, 0.4, 0.95);
  const warnFraction = Math.min(
    clampFraction(cm?.warnFraction, d.warnFraction, 0.3, 0.94),
    triggerFraction - 0.01
  );
  return {
    enabled,
    triggerFraction,
    warnFraction,
    effectiveWindowFraction: clampFraction(
      cm?.effectiveWindowFraction,
      d.effectiveWindowFraction,
      0.5,
      1
    ),
    keepLastToolResults: clampInt(cm?.keepLastToolResults, d.keepLastToolResults, 0, 20),
    summarizationEnabled:
      typeof cm?.summarizationEnabled === 'boolean'
        ? cm.summarizationEnabled
        : d.summarizationEnabled,
    cooldownMs: clampInt(cm?.cooldownMs, d.cooldownMs, 0, 5 * 60 * 1000),
    minSavingsTokens: clampInt(cm?.minSavingsTokens, d.minSavingsTokens, 0, 1_000_000),
    // 0 means "disabled"; otherwise clamp to a sane sub-window-sized band.
    absoluteCeilingTokens:
      cm?.absoluteCeilingTokens === 0
        ? 0
        : clampInt(cm?.absoluteCeilingTokens, d.absoluteCeilingTokens, 16_000, 2_000_000),
    summaryModel: resolveSummaryModel(cm?.summaryModel),
    serverSideCompaction:
      typeof cm?.serverSideCompaction === 'boolean'
        ? cm.serverSideCompaction
        : d.serverSideCompaction
  };
}

/** A summary model is only valid when BOTH ids are non-empty strings. */
function resolveSummaryModel(
  raw: { providerId?: string; modelId?: string } | undefined
): { providerId: string; modelId: string } | null {
  const providerId = typeof raw?.providerId === 'string' ? raw.providerId.trim() : '';
  const modelId = typeof raw?.modelId === 'string' ? raw.modelId.trim() : '';
  if (providerId.length === 0 || modelId.length === 0) return null;
  return { providerId, modelId };
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
    contextManagement: resolveContextManagement(a)
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
