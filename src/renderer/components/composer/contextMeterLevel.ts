import {
  summarizeContextUsage,
  type ContextLevel,
  type ContextLevelThresholds,
  type ContextUsageSummary
} from '@shared/context/contextLevel.js';
import type { ModelSelection } from '@shared/types/provider.js';
import type { TimelineEvent } from '@shared/types/chat.js';
export type ContextMeterLevel = ContextLevel;

type ContextUsageEvent = Extract<TimelineEvent, { kind: 'context-usage' }>;

export function modelSelectionKey(model: ModelSelection): string {
  return `${model.providerId}\0${model.modelId}`;
}

export function evaluationScopeKey(opts: {
  model: ModelSelection;
  workspaceId: string;
  conversationId: string | null;
  settingsKey: string;
  /** Discovered (or overridden) context window — re-evaluate when discovery updates. */
  contextWindow?: number;
}): string {
  return [
    modelSelectionKey(opts.model),
    opts.workspaceId,
    opts.conversationId ?? '',
    opts.settingsKey,
    opts.contextWindow ?? 0
  ].join('|');
}
/** True when live telemetry was emitted for the composer's current model. */
export function liveUsageMatchesModel(
  event: ContextUsageEvent,
  model: ModelSelection,
  isRunActive: boolean
): boolean {
  if (event.providerId !== undefined && event.modelId !== undefined) {
    return event.providerId === model.providerId && event.modelId === model.modelId;
  }
  return isRunActive;
}

/**
 * True when a persisted `context-usage` row's window matches the model's
 * current discovered (or overridden) context — rejects pre-migration 200k caps.
 */
export function liveUsageWindowMatchesDiscovered(
  event: ContextUsageEvent,
  advertisedWindow: number | undefined
): boolean {
  if (typeof advertisedWindow !== 'number' || advertisedWindow <= 0) return false;
  return event.effectiveWindow === advertisedWindow;
}

/** Prefer the live discovered window; fall back to the event payload. */
export function resolveLiveAdvertisedWindow(
  event: ContextUsageEvent,
  currentAdvertised: number | undefined
): number {
  if (typeof currentAdvertised === 'number' && currentAdvertised > 0) {
    return currentAdvertised;
  }
  return event.advertisedWindow;
}

/** Re-summarize a `context-usage` row with the current model window + thresholds. */
export function summarizeLiveContextUsage(
  event: ContextUsageEvent,
  opts: {
    advertisedWindow: number;
    thresholds: ContextLevelThresholds;
  }
): ContextUsageSummary {
  return summarizeContextUsage({
    usedTokens: event.usedTokens,
    advertisedWindow: opts.advertisedWindow,
    thresholds: opts.thresholds,
    exact: event.exact,
    ...(event.breakdown ? { breakdown: event.breakdown } : {})
  });
}

export function contextPercent(usage: ContextUsageSummary): number {
  return Math.min(100, Math.max(0, Math.round(usage.fractionUsed * 100)));
}

export function levelClasses(level: ContextMeterLevel): { text: string; bar: string } {
  switch (level) {
    case 'critical':
      return { text: 'text-danger', bar: 'bg-danger' };
    case 'trigger':
      return { text: 'text-warning', bar: 'bg-warning' };
    case 'warn':
      return { text: 'text-warning', bar: 'bg-warning' };
    case 'ok':
      return { text: 'text-text-faint', bar: 'bg-accent' };
    default: {
      const _exhaustive: never = level;
      void _exhaustive;
      return { text: 'text-text-faint', bar: 'bg-accent' };
    }
  }
}

/** Short tier word for warn / trigger / critical zones. */
export function levelLabel(level: ContextMeterLevel): string | null {
  switch (level) {
    case 'critical':
      return 'critical';
    case 'trigger':
      return 'reducing';
    case 'warn':
      return 'filling';
    case 'ok':
      return null;
    default: {
      const _exhaustive: never = level;
      void _exhaustive;
      return null;
    }
  }
}

export function isContextReducing(level: ContextMeterLevel): boolean {
  return level === 'trigger' || level === 'critical';
}

/** Tooltip when compaction pressure and window fill diverge (large-window models). */
export function levelDetailTitle(usage: ContextUsageSummary): string | undefined {
  const label = levelLabel(usage.level);
  if (!label) return undefined;
  const pct = contextPercent(usage);
  return `Compaction ${label} — ${pct}% of model context window`;
}