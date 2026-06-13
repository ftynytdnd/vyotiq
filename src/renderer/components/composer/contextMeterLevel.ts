import type { ContextLevel, ContextUsageSummary } from '@shared/context/contextLevel.js';
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
}): string {
  return [
    modelSelectionKey(opts.model),
    opts.workspaceId,
    opts.conversationId ?? '',
    opts.settingsKey
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
