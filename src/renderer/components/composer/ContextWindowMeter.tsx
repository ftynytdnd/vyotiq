/**
 * Compact context-window meter for the composer. Opens a dense layer
 * breakdown popover; Compact / Reset live in the popover footer.
 */

import { memo, useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ModelSelection } from '@shared/types/provider.js';
import type { PromptAttachmentMeta } from '@shared/types/chat.js';
import type { ContextUsageSummary } from '@shared/context/contextLevel.js';
import { cn } from '../../lib/cn.js';
import { vyotiq } from '../../lib/ipc.js';
import { useToastStore } from '../../store/useToastStore.js';
import { formatTokenCountWithUnit } from '../../lib/formatTokens.js';
import { formatComposerCostUsd } from '@shared/providers/estimateRunCost.js';
import { useProviderStore } from '../../store/useProviderStore.js';
import { findProviderModel } from './modelPicker/modelPickerContext.js';
import { useContextWindowUsage } from './useContextWindowUsage.js';
import { ContextBreakdownPopover } from './ContextBreakdownPopover.js';
import {
  contextPercent,
  isContextReducing,
  levelClasses,
  levelDetailTitle,
  levelLabel
} from './contextMeterLevel.js';

interface ContextWindowMeterProps {
  model: ModelSelection | null;
  conversationId: string | null;
  workspaceId: string | null;
  draftPrompt: string;
  attachmentDraft: PromptAttachmentMeta[];
  disabled?: boolean;
  isRunActive: boolean;
}

function breakdownTitle(
  usage: ContextUsageSummary,
  percent: number,
  tierLabel: string | null
): string {
  const approx = usage.exact ? '' : ' (approximate)';
  const base =
    `Context: ${formatTokenCountWithUnit(usage.usedTokens)} of ` +
    `${formatTokenCountWithUnit(usage.effectiveWindow)}${approx} — ${percent}%`;
  const compactionDetail = levelDetailTitle(usage);
  if (compactionDetail) return `${base} · ${compactionDetail}`;
  return tierLabel ? `${base} (${tierLabel})` : base;
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
  const { usage, evaluating } = useContextWindowUsage({
    model,
    conversationId,
    workspaceId,
    draftPrompt,
    attachmentDraft,
    isRunActive
  });
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [compactionNote, setCompactionNote] = useState<string | null>(null);
  const providers = useProviderStore((s) => s.providers);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const compactOfferRef = useRef<string | null>(null);
  const panelId = useId();

  useEffect(() => {
    if (!usage || isRunActive || busy) return;
    if (usage.level !== 'trigger' && usage.level !== 'critical') {
      compactOfferRef.current = null;
      return;
    }
    const key = `${usage.level}:${usage.usedTokens}`;
    if (compactOfferRef.current === key) return;
    compactOfferRef.current = key;
    setCompactionNote('Context high — open meter or Compact now.');
    setOpen(true);
  }, [usage, isRunActive, busy]);

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
          if (reply.changed && reply.tokensRemoved && reply.tokensRemoved > 0 && model) {
            const provider = providers.find((p) => p.id === model.providerId);
            const pricing = provider
              ? findProviderModel(provider, model.modelId)?.pricing
              : undefined;
            const inputRate = pricing?.inputPerMillion ?? 0;
            const avoided =
              inputRate > 0
                ? (reply.tokensRemoved / 1_000_000) * inputRate
                : 0;
            setCompactionNote(
              `Compacted ${formatTokenCountWithUnit(reply.tokensRemoved)} tok` +
                (avoided > 0 ? ` · ~${formatComposerCostUsd(avoided)} avoided/turn` : '')
            );
          }
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
          if (reply.changed) setOpen(false);
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
    [conversationId, model, busy, providers]
  );

  if (!usage || usage.effectiveWindow <= 0) return null;

  const percent = contextPercent(usage);
  const { text, bar } = levelClasses(usage.level);
  const tierLabel = levelLabel(usage.level);
  const reducing = isContextReducing(usage.level);
  const controlsEnabled = !disabled && !busy && Boolean(conversationId) && Boolean(model);

  return (
    <>
      {compactionNote ? (
        <span
          className="vx-composer-token-pill shrink-0 font-mono text-meta tabular-nums text-text-faint"
          title="Last context compaction in this composer session"
        >
          {compactionNote}
        </span>
      ) : null}
      <button
        ref={triggerRef}
        type="button"
        className={cn(
          'vx-composer-token-pill vx-context-meter-pill shrink-0',
          open && 'vx-context-meter-pill--open',
          evaluating && 'vx-context-meter-pill--evaluating'
        )}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={panelId}
        aria-label={`Context window ${percent}% full. Show breakdown.`}
        title={breakdownTitle(usage, percent, tierLabel)}
      >
        <span className="vx-composer-token-pill__track" aria-hidden>
          <span
            className={cn('vx-composer-token-pill__bar', bar, reducing && 'vx-context-meter__bar--active')}
            style={{ width: `${percent}%` }}
          />
        </span>
        <span className="vx-composer-token-pill__ctx text-text-faint" aria-hidden>
          ctx
        </span>
        <span className={cn('vx-composer-token-pill__pct tabular-nums', text)}>{percent}%</span>
      </button>
      <ContextBreakdownPopover
        id={panelId}
        open={open}
        onClose={() => setOpen(false)}
        triggerRef={triggerRef}
        usage={usage}
        evaluating={evaluating}
        controlsEnabled={controlsEnabled}
        hasConversation={Boolean(conversationId)}
        onCompact={() => void run('compact')}
        onReset={() => void run('reset')}
      />
    </>
  );
});
