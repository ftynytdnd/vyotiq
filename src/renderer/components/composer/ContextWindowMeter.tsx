/**
 * Compact context-window meter for the composer. Opens a dense layer
 * breakdown popover; Compact / Reset live in the popover footer.
 */

import { memo, useCallback, useId, useRef, useState } from 'react';
import type { ModelSelection } from '@shared/types/provider.js';
import type { PromptAttachmentMeta } from '@shared/types/chat.js';
import type { ContextUsageSummary } from '@shared/context/contextLevel.js';
import { cn } from '../../lib/cn.js';
import { vyotiq } from '../../lib/ipc.js';
import { useToastStore } from '../../store/useToastStore.js';
import { formatTokenCountWithUnit } from '../../lib/formatTokens.js';
import { useContextWindowUsage } from './useContextWindowUsage.js';
import { ContextBreakdownPopover } from './ContextBreakdownPopover.js';
import { CONTEXT_BREAKDOWN_LAYERS } from './contextBreakdownLayers.js';
import {
  contextPercent,
  isContextReducing,
  levelClasses,
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
  const modelNote =
    usage.advertisedWindow > 0 && usage.advertisedWindow !== usage.effectiveWindow
      ? ` (model advertises ${formatTokenCountWithUnit(usage.advertisedWindow)})`
      : '';
  const lines = [
    `Context: ${formatTokenCountWithUnit(usage.usedTokens)} of ${formatTokenCountWithUnit(usage.effectiveWindow)} usable${modelNote}`,
    `${percent}%${tierLabel ? ` (${tierLabel})` : ''}${usage.exact ? '' : ' — approximate'}`
  ];
  if (usage.breakdown) {
    lines.push('');
    for (const { key, label } of CONTEXT_BREAKDOWN_LAYERS) {
      const n = usage.breakdown[key];
      if (n > 0) {
        const layerPct =
          usage.effectiveWindow > 0
            ? Math.round((n / usage.effectiveWindow) * 100)
            : 0;
        lines.push(`${label}: ${formatTokenCountWithUnit(n)} (${layerPct}% of window)`);
      }
    }
  }
  return lines.join('\n');
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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

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
    [conversationId, model, busy]
  );

  if (!usage || usage.effectiveWindow <= 0) return null;

  const percent = contextPercent(usage);
  const { text, bar } = levelClasses(usage.level);
  const tierLabel = levelLabel(usage.level);
  const reducing = isContextReducing(usage.level);
  const controlsEnabled = !disabled && !busy && Boolean(conversationId) && Boolean(model);

  return (
    <>
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
