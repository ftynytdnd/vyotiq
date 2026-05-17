/**
 * SubAgentHeader — slim status strip rendered at the top of every
 * expanded sub-agent trace card, immediately above the Briefing.
 *
 * Carries ONLY the signals that aren't already represented by the
 * Briefing or by the file-edit / tool-group rows underneath:
 *
 *   - Sub-agent id + status pill (running / done / failed / aborted).
 *   - Click-cycle token-usage pill (`current` / `peak` / `cumulative`).
 *   - Per-worker live-status phase line (shimmer cadence) WHEN the
 *     worker is actually streaming and no accumulator is open.
 *   - Failure message (red, with `AlertTriangle`) when terminal
 *     state landed with one.
 *
 * Everything else that USED to live here — the redundant
 * `N steps / M edits / K files` metric chips, the file chip wall,
 * and the granted-tools chip wall — moved into
 * `briefing/SubAgentBriefing.tsx` as structured lists. The collapsed
 * row above the trace already reports step / edit counts inline; the
 * Briefing replaces the file/tool chip rails with a Scope subsection
 * that shows each entry with a one-line rationale.
 */

import { useState } from 'react';
import { AlertTriangle, BarChart2, Bot } from 'lucide-react';
import { stripEmoji } from '@shared/text/emoji.js';
import type { SubAgentSnapshot, TokenUsageAggregate } from '../reducer/types.js';
import { cn } from '../../../lib/cn.js';
import { formatTokenCount } from '../../../lib/formatTokens.js';
import { shimmerPill, shimmerStyle, shimmerText } from '../../../lib/shimmer.js';

type UsageView = 'current' | 'peak' | 'cumulative';
const VIEW_CYCLE: UsageView[] = ['current', 'peak', 'cumulative'];
const VIEW_LABEL: Record<UsageView, string> = {
  current: 'current',
  peak: 'peak',
  cumulative: 'cumulative'
};

interface SubAgentHeaderProps {
  snap: SubAgentSnapshot;
}

export function SubAgentHeader({ snap }: SubAgentHeaderProps) {
  const isLive = snap.status === 'pending' || snap.status === 'running';
  const statusPillClass =
    snap.status === 'done'
      ? 'bg-success/10 text-success'
      : snap.status === 'failed' || snap.status === 'aborted'
        ? 'bg-danger/10 text-danger'
        : 'bg-accent-soft/70 text-accent';

  return (
    <div className="flex items-start gap-2">
      <Bot className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-faint" strokeWidth={2} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5 text-row text-text-muted">
          <span className="font-medium text-text-secondary">Sub-agent {snap.id}</span>
          <span
            className={cn('rounded-inner px-1.5 py-0.5 text-meta font-medium capitalize', statusPillClass)}
          >
            <span
              className={shimmerPill(isLive)}
              style={isLive ? shimmerStyle(`subagent-pill:${snap.id}`) : undefined}
            >
              {snap.status}
            </span>
          </span>
          {snap.usage && <SubAgentUsagePill usage={snap.usage} />}
        </div>
        {shouldShowLiveStatus(snap) && snap.liveStatus && (
          <div
            role="status"
            aria-live="polite"
            className={cn('mt-1 line-clamp-1 text-meta', shimmerText(true, 'text-text-faint'))}
            style={shimmerStyle(`subagent-phase:${snap.id}:${snap.liveStatus.phase}`)}
          >
            {snap.liveStatus.label}
          </div>
        )}
        {snap.message && (
          <div className="mt-1 flex items-start gap-1.5 text-row text-danger">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" strokeWidth={2.25} />
            <span className="line-clamp-2">{stripEmoji(snap.message)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Whether to render the per-worker live-status line under the
 * status strip.
 *
 * Combines three guards in one predicate so the gate stays a single
 * readable boolean instead of a chain of inline `&&`s:
 *
 *   1. **Worker actually running.** Pending workers are already
 *      signalled by the shimmering `Pending` pill above.
 *   2. **No accumulator is actively streaming right now.** Once any
 *      iteration's reasoning OR text accumulator is open and
 *      non-empty, the in-flight panel inside `SubAgentRunFlow`
 *      already carries the shimmer cadence; the header line would
 *      contradict it.
 *   3. **`liveStatus.ts` is fresh relative to closed accumulators.**
 *      The reducer keeps `liveStatus` set across an entire
 *      iteration (it only clears on terminal transitions), so the
 *      slot can go stale when iteration N's `awaiting-response`
 *      lingers after iteration N's reasoning AND text have BOTH
 *      closed. The fix: only render when `liveStatus.ts` is at
 *      least as recent as the most-recently-started accumulator.
 */
function shouldShowLiveStatus(snap: SubAgentSnapshot): boolean {
  if (snap.status !== 'running') return false;
  if (!snap.liveStatus) return false;

  for (const id in snap.reasoningTexts) {
    const r = snap.reasoningTexts[id]!;
    if (!r.done && r.text.length > 0) return false;
  }
  for (const id in snap.assistantTexts) {
    const t = snap.assistantTexts[id]!;
    if (!t.done && t.text.length > 0) return false;
  }

  let latestAccumulatorStart = 0;
  for (const id in snap.reasoningTexts) {
    const r = snap.reasoningTexts[id]!;
    if (r.startedAt > latestAccumulatorStart) latestAccumulatorStart = r.startedAt;
  }
  for (const id in snap.assistantTexts) {
    const t = snap.assistantTexts[id]!;
    const startedAt = t.startedAt ?? 0;
    if (startedAt > latestAccumulatorStart) latestAccumulatorStart = startedAt;
  }
  return snap.liveStatus.ts >= latestAccumulatorStart;
}

/**
 * Click-cycle token-usage chip. Shows `current` / `peak` /
 * `cumulative` one at a time; clicking advances the cycle. The
 * `title` tooltip always lists all three values so the hidden
 * views stay discoverable without a popover.
 */
function SubAgentUsagePill({ usage }: { usage: TokenUsageAggregate }) {
  const [view, setView] = useState<UsageView>('current');

  const current = usage.latest.promptTokens + usage.latest.completionTokens;
  const peak = usage.peak.promptTokens;
  const cumulative = usage.cumulative.promptTokens + usage.cumulative.completionTokens;

  const value = view === 'current' ? current : view === 'peak' ? peak : cumulative;

  const tooltip =
    `Current ${current.toLocaleString()} · ` +
    `Peak ${peak.toLocaleString()} · ` +
    `Cumulative ${cumulative.toLocaleString()} tokens ` +
    `(click to cycle — showing ${VIEW_LABEL[view]})`;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        const idx = VIEW_CYCLE.indexOf(view);
        setView(VIEW_CYCLE[(idx + 1) % VIEW_CYCLE.length]!);
      }}
      title={tooltip}
      className={cn(
        'inline-flex items-center gap-1 rounded-inner bg-surface-overlay px-1.5 py-0.5 text-meta text-text-faint',
        'hover:bg-surface-hover hover:text-text-secondary',
        'transition-colors duration-150'
      )}
    >
      <BarChart2 className="h-2.5 w-2.5" strokeWidth={2} />
      <span className="font-mono">{formatTokenCount(value)}</span>
      {view !== 'current' && (
        <span className="text-meta text-text-faint">{VIEW_LABEL[view]}</span>
      )}
    </button>
  );
}
