/**
 * Per-layer context breakdown popover for the composer meter.
 */

import { memo, useRef, useState } from 'react';
import type { ContextUsageBreakdown, ContextUsageSummary } from '@shared/context/contextLevel.js';
import { sumContextBreakdown } from '@shared/context/contextLevel.js';
import { cn } from '../../lib/cn.js';
import { formatTokenCountWithUnit } from '../../lib/formatTokens.js';
import { Popover } from '../ui/Popover.js';

const LAYER_ROWS: ReadonlyArray<{
  key: keyof ContextUsageBreakdown;
  label: string;
  hint: string;
}> = [
  { key: 'system', label: 'System prompt', hint: 'Harness + agent meta-rules' },
  { key: 'fewShot', label: 'Few-shot examples', hint: 'Static instruction examples' },
  { key: 'workspace', label: 'Workspace', hint: 'Project listing + workspace envelope' },
  { key: 'history', label: 'History', hint: 'Prior turns, tool calls, and results' },
  { key: 'runtime', label: 'Runtime', hint: 'Host env, session, run state, memory' },
  { key: 'turn', label: 'Turn', hint: 'Current user message + attachments' },
  { key: 'tools', label: 'Tools', hint: 'Tool schema catalogue on the wire' }
];

interface ContextBreakdownPopoverProps {
  usage: ContextUsageSummary;
}

function layerPercent(tokens: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((tokens / total) * 100);
}

export const ContextBreakdownPopover = memo(function ContextBreakdownPopover({
  usage
}: ContextBreakdownPopoverProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const breakdown = usage.breakdown;
  const breakdownTotal = breakdown ? sumContextBreakdown(breakdown) : usage.usedTokens;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="vx-context-meter__action text-text-faint transition-colors hover:text-text-secondary"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Show context window breakdown"
        title="Show what is using the context window"
      >
        Breakdown
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        triggerRef={triggerRef}
        preferSide="top"
        align="end"
        collisionPadding={{ top: 12, bottom: 12, left: 12, right: 12 }}
        className="vx-context-breakdown-popover overflow-hidden rounded-md border border-border-subtle bg-surface-raised shadow-lg"
      >
        <div className="vx-context-breakdown-popover__header border-b border-border-subtle px-3 py-2">
          <div className="font-mono text-meta text-text-secondary">Context breakdown</div>
          <div className="mt-0.5 font-mono text-caption text-text-faint tabular-nums">
            {formatTokenCountWithUnit(usage.usedTokens)}
            <span className="mx-1" aria-hidden>
              /
            </span>
            {formatTokenCountWithUnit(usage.effectiveWindow)} usable
            {!usage.exact ? ' (approx.)' : ''}
          </div>
        </div>
        <ul className="vx-context-breakdown-popover__list max-h-72 overflow-y-auto px-2 py-2">
          {breakdown ? (
            LAYER_ROWS.map(({ key, label, hint }) => {
              const tokens = breakdown[key];
              const pct = layerPercent(tokens, breakdownTotal);
              return (
                <li
                  key={key}
                  className="vx-context-breakdown-popover__row grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 rounded px-1 py-1.5"
                >
                  <div className="min-w-0">
                    <div className="font-mono text-meta text-text-secondary">{label}</div>
                    <div className="truncate font-mono text-caption text-text-faint">{hint}</div>
                  </div>
                  <div className="text-right font-mono text-meta tabular-nums text-text-secondary">
                    {formatTokenCountWithUnit(tokens)}
                    <span className="ml-1 text-text-faint">{pct}%</span>
                  </div>
                  <div className="col-span-2">
                    <div className="vx-composer-token-pill__track h-1" aria-hidden>
                      <span
                        className={cn('vx-composer-token-pill__bar bg-accent/70 h-full')}
                        style={{ width: `${Math.min(100, pct)}%` }}
                      />
                    </div>
                  </div>
                </li>
              );
            })
          ) : (
            <li className="px-1 py-2 font-mono text-caption text-text-faint">
              Layer breakdown unavailable — waiting for evaluation.
            </li>
          )}
        </ul>
      </Popover>
    </>
  );
});
