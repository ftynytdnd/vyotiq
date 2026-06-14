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
  formatLayerWindowPct,
  formatOmittedLayerNote,
  layerCompositionShare
} from './contextBreakdownLayers.js';
import { contextPercent, levelClasses, levelDetailTitle, levelLabel } from './contextMeterLevel.js';

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
  const contextWindow = usage.effectiveWindow;
  const percent = contextPercent(usage);
  const tierLabel = levelLabel(usage.level);
  const tierClass = levelClasses(usage.level).text;
  const tierTitle = levelDetailTitle(usage);
  const activeLayers = breakdown ? activeBreakdownLayers(breakdown) : [];
  const emptyLabels = breakdown ? emptyBreakdownLabels(breakdown) : [];
  const omittedNote =
    breakdown && emptyLabels.length > 0
      ? formatOmittedLayerNote(emptyLabels, breakdown)
      : null;

  return (
    <Popover
      open={open}
      onClose={onClose}
      triggerRef={triggerRef}
      preferSide="top"
      align="end"
      collisionPadding={{ top: 8, bottom: 8, left: 8, right: 8 }}
      fitMaxWidth={352}
      className="vx-context-breakdown-popover"
    >
      <div
        id={id}
        role="dialog"
        aria-labelledby={titleId}
        className="vx-context-breakdown-popover__inner"
      >
        <header className="vx-context-breakdown-popover__head">
          <div className="vx-context-breakdown-popover__head-main">
            <h2 id={titleId} className="vx-context-breakdown-popover__title">
              Context
              {tierLabel ? (
                <span
                  className={cn('vx-context-breakdown-popover__tier', tierClass)}
                  title={tierTitle}
                >
                  {tierLabel}
                </span>
              ) : null}
            </h2>
          </div>
          <div className="vx-context-breakdown-popover__metrics">
            <p className="vx-context-breakdown-popover__metrics-primary tabular-nums">
              <span className="vx-context-breakdown-popover__metrics-used">
                {formatTokenCount(usage.usedTokens)}
              </span>
              <span className="vx-context-breakdown-popover__metrics-sep" aria-hidden>
                /
              </span>
              <span className="vx-context-breakdown-popover__metrics-window">
                {formatTokenCount(contextWindow)}
              </span>
              <span className="vx-context-breakdown-popover__metrics-sep" aria-hidden>
                ·
              </span>
              <span className="vx-context-breakdown-popover__metrics-pct">{percent}%</span>
              {!usage.exact ? (
                <>
                  <span className="vx-context-breakdown-popover__metrics-sep" aria-hidden>
                    ·
                  </span>
                  <span
                    className="vx-context-breakdown-popover__metrics-est"
                    title="Heuristic estimate until the provider bills a turn"
                  >
                    est
                  </span>
                </>
              ) : null}
            </p>
          </div>
        </header>

        {breakdown && usedTokens > 0 ? (
          <div className="vx-context-breakdown-popover__stack-wrap">
            <StackedBar breakdown={breakdown} usedTokens={usedTokens} />
          </div>
        ) : null}

        <div className="vx-context-breakdown-popover__table-wrap">
          {evaluating && !breakdown ? (
            <p className="vx-context-breakdown-popover__empty">Measuring…</p>
          ) : breakdown && activeLayers.length > 0 ? (
            <table
              className="vx-context-breakdown-popover__table"
              aria-busy={evaluating}
              aria-label="Context usage by layer"
            >
              <colgroup>
                <col className="vx-context-breakdown-popover__col-layer" />
                <col className="vx-context-breakdown-popover__col-tokens" />
                <col className="vx-context-breakdown-popover__col-pct" />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">Layer</th>
                  <th scope="col" className="vx-context-breakdown-popover__num">
                    Tokens
                  </th>
                  <th
                    scope="col"
                    className="vx-context-breakdown-popover__num"
                    title="% of model context window"
                  >
                    %
                  </th>
                </tr>
              </thead>
              <tbody>
                {activeLayers.map(({ key, label, title, tokens }) => {
                  const composition = layerCompositionShare(tokens, usedTokens);
                  const windowPctLabel = formatLayerWindowPct(tokens, contextWindow);
                  const rowTitle =
                    usedTokens > 0
                      ? `${title} — ${windowPctLabel} of context window (${composition}% of prompt)`
                      : title;
                  return (
                    <tr key={key} title={rowTitle}>
                      <td>
                        <span className="vx-context-breakdown-popover__layer">
                          <span
                            className={cn(
                              'vx-context-breakdown-popover__swatch',
                              `vx-context-breakdown-popover__swatch--${key}`
                            )}
                            aria-hidden
                          />
                          <span className="vx-context-breakdown-popover__layer-label">{label}</span>
                        </span>
                      </td>
                      <td className="vx-context-breakdown-popover__num tabular-nums">
                        {formatTokenCount(tokens)}
                      </td>
                      <td className="vx-context-breakdown-popover__num tabular-nums">
                        {windowPctLabel}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : breakdown ? (
            <p className="vx-context-breakdown-popover__empty">No measured usage yet.</p>
          ) : (
            <p className="vx-context-breakdown-popover__empty">Measuring…</p>
          )}
        </div>

        {omittedNote ? (
          <p className="vx-context-breakdown-popover__omitted">{omittedNote}</p>
        ) : null}

        <footer className="vx-context-breakdown-popover__foot">
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
              <span className="vx-context-breakdown-popover__foot-sep" aria-hidden>
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
        </footer>
      </div>
    </Popover>
  );
});
