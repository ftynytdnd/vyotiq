/**
 * Dense per-layer context breakdown panel (popover content).
 */

import { memo, useId, type RefObject } from 'react';
import type { ContextUsageSummary } from '@shared/context/contextLevel.js';
import { cn } from '../../lib/cn.js';
import { formatTokenCount } from '../../lib/formatTokens.js';
import { Popover } from '../ui/Popover.js';
import {
  activeBreakdownLayers,
  CONTEXT_BREAKDOWN_LAYERS,
  emptyBreakdownLabels,
  layerCompositionShare,
  layerWindowShare
} from './contextBreakdownLayers.js';
import { contextPercent, levelClasses, levelLabel } from './contextMeterLevel.js';

interface ContextBreakdownPopoverProps {
  id: string;
  open: boolean;
  onClose: () => void;
  triggerRef: RefObject<HTMLElement | null>;
  usage: ContextUsageSummary;
  evaluating: boolean;
  onCompact: () => void;
  onReset: () => void;
  controlsEnabled: boolean;
  hasConversation: boolean;
}

function StackedBar({
  breakdown,
  usedTokens
}: {
  breakdown: NonNullable<ContextUsageSummary['breakdown']>;
  usedTokens: number;
}) {
  const segments = CONTEXT_BREAKDOWN_LAYERS.map(({ key }) => ({
    key,
    share: layerCompositionShare(breakdown[key], usedTokens)
  })).filter((s) => s.share > 0);

  if (segments.length === 0) return null;

  return (
    <div className="vx-context-breakdown__stack" role="img" aria-label="Context usage by layer">
      {segments.map(({ key, share }) => (
        <span
          key={key}
          className={cn('vx-context-breakdown__stack-seg', `vx-context-breakdown__stack-seg--${key}`)}
          style={{ width: `${share}%` }}
        />
      ))}
    </div>
  );
}

export const ContextBreakdownPopover = memo(function ContextBreakdownPopover({
  id,
  open,
  onClose,
  triggerRef,
  usage,
  evaluating,
  onCompact,
  onReset,
  controlsEnabled,
  hasConversation
}: ContextBreakdownPopoverProps) {
  const titleId = useId();
  const breakdown = usage.breakdown;
  const usedTokens = usage.usedTokens > 0 ? usage.usedTokens : 0;
  const effectiveWindow = usage.effectiveWindow;
  const showModelWindow =
    usage.advertisedWindow > 0 && usage.advertisedWindow !== effectiveWindow;
  const percent = contextPercent(usage);
  const tierLabel = levelLabel(usage.level);
  const tierClass = levelClasses(usage.level).text;
  const activeLayers = breakdown ? activeBreakdownLayers(breakdown) : [];
  const emptyLabels = breakdown ? emptyBreakdownLabels(breakdown) : [];

  return (
    <Popover
      open={open}
      onClose={onClose}
      triggerRef={triggerRef}
      preferSide="top"
      align="end"
      collisionPadding={{ top: 8, bottom: 8, left: 8, right: 8 }}
      fitMaxWidth={288}
      className="vx-context-breakdown-popover"
    >
      <div
        id={id}
        role="dialog"
        aria-labelledby={titleId}
        className="vx-context-breakdown-popover__inner"
      >
        <div className="vx-context-breakdown-popover__head">
          <span id={titleId} className="vx-context-breakdown-popover__title">
            Context
            {tierLabel ? (
              <span className={cn('vx-context-breakdown-popover__tier', tierClass)}>
                {tierLabel}
              </span>
            ) : null}
          </span>
          <span
            className="vx-context-breakdown-popover__summary tabular-nums"
            title={
              showModelWindow
                ? `Usable window ${formatTokenCount(effectiveWindow)} (model advertises ${formatTokenCount(usage.advertisedWindow)})`
                : undefined
            }
          >
            {formatTokenCount(usage.usedTokens)}
            <span className="text-text-faint" aria-hidden>
              /
            </span>
            {formatTokenCount(effectiveWindow)}
            <span className="text-text-faint" aria-hidden>
              {' '}
              ·{' '}
            </span>
            {percent}%
            {showModelWindow ? (
              <>
                <span className="text-text-faint" aria-hidden>
                  {' '}
                  ·{' '}
                </span>
                <span className="vx-context-breakdown-popover__model-window">
                  {formatTokenCount(usage.advertisedWindow)} model
                </span>
              </>
            ) : null}
            {!usage.exact ? (
              <span className="text-text-faint" title="Heuristic estimate">
                {' '}
                ~
              </span>
            ) : null}
          </span>
        </div>

        {breakdown && usedTokens > 0 ? (
          <StackedBar breakdown={breakdown} usedTokens={usedTokens} />
        ) : null}

        <ul
          className="vx-context-breakdown-popover__rows"
          aria-busy={evaluating}
          aria-label="Context usage by layer, percent of usable window"
        >
          {evaluating && !breakdown ? (
            <li className="vx-context-breakdown-popover__empty">Measuring…</li>
          ) : breakdown && activeLayers.length > 0 ? (
            activeLayers.map(({ key, label, title, tokens }) => {
              const composition = layerCompositionShare(tokens, usedTokens);
              const windowPct = layerWindowShare(tokens, effectiveWindow);
              const rowTitle =
                usedTokens > 0
                  ? `${title} — ${windowPct}% of usable window`
                  : title;
              return (
                <li
                  key={key}
                  className="vx-context-breakdown-popover__row"
                  title={rowTitle}
                >
                  <span className="vx-context-breakdown-popover__label">{label}</span>
                  <span className="vx-context-breakdown-popover__bar" aria-hidden>
                    <span
                      className={cn(
                        'vx-context-breakdown-popover__bar-fill',
                        `vx-context-breakdown-popover__bar-fill--${key}`
                      )}
                      style={{ width: `${Math.max(composition, 4)}%` }}
                    />
                  </span>
                  <span className="vx-context-breakdown-popover__tokens tabular-nums">
                    {formatTokenCount(tokens)}
                  </span>
                  <span className="vx-context-breakdown-popover__pct tabular-nums">
                    {windowPct}%
                  </span>
                </li>
              );
            })
          ) : breakdown ? (
            <li className="vx-context-breakdown-popover__empty">No measured usage yet.</li>
          ) : (
            <li className="vx-context-breakdown-popover__empty">Measuring…</li>
          )}
        </ul>

        {emptyLabels.length > 0 ? (
          <p className="vx-context-breakdown-popover__omitted">
            {emptyLabels.join(', ')} empty
          </p>
        ) : null}

        <div className="vx-context-breakdown-popover__foot">
          {hasConversation ? (
            <>
              <button
                type="button"
                className="vx-context-breakdown-popover__action"
                disabled={!controlsEnabled}
                onClick={onCompact}
              >
                Compact
              </button>
              <span className="text-text-faint" aria-hidden>
                ·
              </span>
              <button
                type="button"
                className="vx-context-breakdown-popover__action"
                disabled={!controlsEnabled}
                onClick={onReset}
              >
                Reset
              </button>
            </>
          ) : (
            <span className="vx-context-breakdown-popover__hint">Start a chat to manage context</span>
          )}
        </div>
      </div>
    </Popover>
  );
});
