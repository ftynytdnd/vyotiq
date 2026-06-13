/**
 * Always-visible context-window meter for the composer. Shows how full the
 * prompt is relative to the model's *effective* window, color-coded at the
 * warn / trigger thresholds, with manual "Compact now" / "Reset context"
 * controls. Matches the Shell Mono composer chrome (mono meta, tabular nums,
 * the existing `vx-composer-token-pill__track/__bar` meter CSS).
 */

import { memo, useCallback, useState } from 'react';
import type { ModelSelection } from '@shared/types/provider.js';
import type { PromptAttachmentMeta } from '@shared/types/chat.js';
import { cn } from '../../lib/cn.js';
import { vyotiq } from '../../lib/ipc.js';
import { useToastStore } from '../../store/useToastStore.js';
import { formatTokenCountWithUnit } from '../../lib/formatTokens.js';
import { useContextWindowUsage } from './useContextWindowUsage.js';
import { ContextBreakdownPopover } from './ContextBreakdownPopover.js';

interface ContextWindowMeterProps {
  model: ModelSelection | null;
  conversationId: string | null;
  workspaceId: string | null;
  draftPrompt: string;
  attachmentDraft: PromptAttachmentMeta[];
  /** Disable manual controls while a run is active. */
  disabled?: boolean;
  isRunActive: boolean;
}

type ContextMeterLevel = 'ok' | 'warn' | 'trigger' | 'critical';

function levelClasses(level: ContextMeterLevel): {
  text: string;
  bar: string;
} {
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

/** Short tier word shown next to the % once usage leaves the safe zone. */
function levelLabel(level: ContextMeterLevel): string | null {
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

export const ContextWindowMeter = memo(function ContextWindowMeter({
  model,
  conversationId,
  workspaceId,
  draftPrompt,
  attachmentDraft,
  disabled = false,
  isRunActive
}: ContextWindowMeterProps) {
  const usage = useContextWindowUsage({
    model,
    conversationId,
    workspaceId,
    draftPrompt,
    attachmentDraft,
    isRunActive
  });
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async (mode: 'compact' | 'reset') => {
      if (!conversationId || !model || busy) return;
      setBusy(true);
      try {
        const input = {
          conversationId,
          selection: { providerId: model.providerId, modelId: model.modelId }
        };
        const reply =
          mode === 'compact'
            ? await vyotiq.context.compactNow(input)
            : await vyotiq.context.reset(input);
        const toast = useToastStore.getState().show;
        if (reply.ok) {
          toast(
            mode === 'compact'
              ? reply.changed
                ? 'Context compacted — older detail offloaded.'
                : 'Nothing to compact yet.'
              : reply.changed
                ? 'Context reset — history summarized into a lean note.'
                : 'Nothing to summarize yet.',
            reply.changed ? 'success' : 'info'
          );
        } else if (reply.reason === 'busy') {
          toast('Finish or stop the active run before managing context.', 'info');
        } else {
          toast(`Could not ${mode} context${reply.message ? `: ${reply.message}` : '.'}`, 'danger');
        }
      } catch (err) {
        useToastStore
          .getState()
          .show(`Could not ${mode} context: ${err instanceof Error ? err.message : String(err)}`, 'danger');
      } finally {
        setBusy(false);
      }
    },
    [conversationId, model, busy]
  );

  if (!usage || usage.effectiveWindow <= 0) return null;

  const percent = Math.min(100, Math.max(0, Math.round(usage.fractionUsed * 100)));
  const { text, bar } = levelClasses(usage.level);
  const tierLabel = levelLabel(usage.level);
  const reducing = usage.level === 'trigger' || usage.level === 'critical';
  const title =
    `Context: ${formatTokenCountWithUnit(usage.usedTokens)} of ` +
    `${formatTokenCountWithUnit(usage.effectiveWindow)} usable` +
    `${usage.exact ? '' : ' (approx.)'} — ${percent}%` +
    `${tierLabel ? ` (${tierLabel})` : ''}`;

  const controlsEnabled = !disabled && !busy && Boolean(conversationId) && Boolean(model);

  return (
    <span
      className="vx-context-meter inline-flex items-center gap-1.5 font-mono text-meta tabular-nums text-text-faint"
      title={title}
    >
      <span className="vx-composer-token-pill__track" aria-hidden>
        <span
          className={cn('vx-composer-token-pill__bar', bar, reducing && 'vx-context-meter__bar--active')}
          style={{ width: `${percent}%` }}
        />
      </span>
      <span className={cn('tabular-nums', text)}>
        {formatTokenCountWithUnit(usage.usedTokens)}
        <span className="text-text-faint/70" aria-hidden>
          /
        </span>
        {formatTokenCountWithUnit(usage.effectiveWindow)}
      </span>
      <span className={cn('tabular-nums', text)}>{percent}%</span>
      {tierLabel && (
        <span className={cn('vx-caption', text)} aria-hidden>
          {tierLabel}
        </span>
      )}
      <ContextBreakdownPopover usage={usage} />
      <span className="text-text-faint/70" aria-hidden>
        ·
      </span>
      <button
        type="button"
        className="vx-context-meter__action text-text-faint transition-colors hover:text-text-secondary disabled:opacity-40"
        onClick={() => void run('compact')}
        disabled={!controlsEnabled}
        title="Compact now — offload older detail reversibly"
        aria-label="Compact context now"
      >
        Compact
      </button>
      <button
        type="button"
        className="vx-context-meter__action text-text-faint transition-colors hover:text-text-secondary disabled:opacity-40"
        onClick={() => void run('reset')}
        disabled={!controlsEnabled}
        title="Reset context — summarize history and continue lean"
        aria-label="Reset context"
      >
        Reset
      </button>
    </span>
  );
});
