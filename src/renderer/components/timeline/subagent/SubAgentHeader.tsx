/**
 * Header strip at the top of a SubAgentTrace card. Surfaces id, task, file
 * attachments, status pill, elapsed time, failure message, and (when
 * usage data is available) a click-cycle token-usage chip.
 */

import { useState } from 'react';
import { AlertTriangle, BarChart2, Bot } from 'lucide-react';
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

/**
 * SubAgentHeader — expanded-detail strip below the collapsed `Delegated`
 * row.
 *
 * Single-source-of-truth contract (audit fix A4):
 *   - The OUTER collapsed row (`SubAgentTrace`) owns the SOLE rendering
 *     of the worker's task — a truncated quoted preview that becomes
 *     the natural section heading once the row is expanded too. The
 *     header below previously duplicated the task as a `task — full
 *     text` line, which read as redundant the moment the row opened.
 *   - This header owns the sub-agent id, status pill, optional usage
 *     chip, file chips, granted-tools chips, live-status phase, and
 *     any failure message.
 */
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
        <div className="flex flex-wrap items-center gap-1 text-row text-text-muted">
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
        <FileChips okFiles={snap.files ?? []} missingFiles={snap.missingFiles ?? []} />
        <ToolChips tools={snap.tools} />
        {shouldShowLiveStatus(snap) && snap.liveStatus && (
          /*
           * Per-worker live phase. Mirrors `LiveStatusRow`'s shimmer
           * cadence but scoped to this sub-agent card. Pending state
           * already implies pre-run via the shimmering `Pending` pill,
           * so this line surfaces ONLY once the worker is actually
           * running. Terminal transitions clear `liveStatus` in the
           * reducer so the row stops shimmering the instant the worker
           * settles. Placed below the file chips and above the error
           * `message` so a failing run's red `message` remains the
           * visually dominant signal.
           */
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
            <span className="line-clamp-2">{snap.message}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Cap on chip rows before the trailing `+N more` overflow control
 * kicks in. Keeps the header from sprawling when a sub-agent operates
 * on a wide file set (see screenshot §1 — 11-file chip wall).
 */
const FILE_CHIP_VISIBLE_CAP = 6;
const TOOL_CHIP_VISIBLE_CAP = 4;

/**
 * Whether to render the per-worker live-status line under the header.
 *
 * Combines three guards in one predicate so the header gate stays a
 * single readable boolean instead of a chain of inline `&&`s:
 *
 *   1. **Worker actually running.** Pending workers are already
 *      signalled by the shimmering `Pending` pill above; surfacing
 *      a separate `Connecting to <provider>…` line under the chips
 *      duplicates the signal. Terminal workers should never re-render
 *      the line (the reducer clears `liveStatus` on terminal
 *      transitions, but belt-and-suspenders).
 *
 *   2. **No accumulator is actively streaming right now.** Once any
 *      iteration's reasoning OR text accumulator is open and
 *      non-empty, the in-flight panel inside `SubAgentRunFlow`
 *      already carries the shimmer cadence — the header line would
 *      contradict it ("Awaiting first token from …" sitting above a
 *      visibly populated `Thinking…` panel — exactly the §1 / §2
 *      regression). Mirrors `LiveStatusRow.pickLiveStream` so the
 *      orchestrator and per-worker surfaces speak the same language.
 *
 *   3. **`liveStatus.ts` is fresh relative to closed accumulators.**
 *      The reducer keeps `liveStatus` set across an entire iteration
 *      (it only clears on terminal transitions), so the slot can
 *      easily go stale: iteration N's `awaiting-response` event
 *      stays in `liveStatus` even after iteration N's reasoning AND
 *      text have BOTH closed. Without this guard there would be a
 *      brief gap (between iter-N's `text.done = true` and iter-(N+1)'s
 *      `connecting` event) where the line re-surfaced with the
 *      stale `Awaiting first token…` label — visible in §3 where
 *      `Thought for 104s` sits next to a populated text body.
 *      The fix: only render when `liveStatus.ts` is at least as
 *      recent as the most-recently-started accumulator. A new
 *      iteration's `connecting`/`awaiting-response` event will
 *      always satisfy this (its `ts` is by definition newer than
 *      the prior iteration's deltas); a stale liveStatus from an
 *      earlier iteration won't.
 *
 * Kept at module scope so the test harness can exercise the
 * predicate directly without rendering React.
 */
function shouldShowLiveStatus(snap: SubAgentSnapshot): boolean {
  if (snap.status !== 'running') return false;
  if (!snap.liveStatus) return false;

  // Suppress while any accumulator is actively producing tokens.
  for (const id in snap.reasoningTexts) {
    const r = snap.reasoningTexts[id]!;
    if (!r.done && r.text.length > 0) return false;
  }
  for (const id in snap.assistantTexts) {
    const t = snap.assistantTexts[id]!;
    if (!t.done && t.text.length > 0) return false;
  }

  // Suppress when liveStatus is older than every closed accumulator
  // (it represents a prior iteration's pre-first-byte phase, not a
  // fresh one).
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
 * File chip row with `+N more` overflow toggle. Missing files always
 * render (they're the actionable signal). When the combined chip count
 * exceeds `FILE_CHIP_VISIBLE_CAP`, ok-files past the cap collapse behind
 * a single click-to-expand chip; missing files are not collapsed since
 * they're rare and important.
 */
function FileChips({
  okFiles,
  missingFiles
}: {
  okFiles: string[];
  missingFiles: string[];
}) {
  const [expanded, setExpanded] = useState(false);
  if (okFiles.length === 0 && missingFiles.length === 0) return null;

  const overflowCount = Math.max(0, okFiles.length - FILE_CHIP_VISIBLE_CAP);
  const visibleOk = expanded || overflowCount === 0
    ? okFiles
    : okFiles.slice(0, FILE_CHIP_VISIBLE_CAP);

  return (
    <div className="mt-1 flex flex-wrap gap-0.5">
      {visibleOk.map((f) => (
        <span
          key={`ok:${f}`}
          title={f}
          className="max-w-[200px] truncate rounded-inner bg-surface-raised/60 px-1.5 py-0.5 font-mono text-meta text-text-faint"
        >
          {f}
        </span>
      ))}
      {overflowCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className={cn(
            'app-no-drag rounded-inner bg-surface-raised/60 px-1.5 py-0.5 text-meta text-text-muted',
            'transition-colors duration-150 hover:bg-surface-hover hover:text-text-primary'
          )}
        >
          {expanded ? 'show less' : `+${overflowCount} more`}
        </button>
      )}
      {/*
        Model-invented paths the orchestrator's pre-spawn validator
        could not resolve against the workspace FS. Rendered with
        strikethrough + danger tone so the user sees the miss explicitly
        instead of the silent drop the old behaviour produced. The
        chip's `title` makes the reason actionable on hover.
      */}
      {missingFiles.map((f) => (
        <span
          key={`miss:${f}`}
          title={`${f} — not found in workspace`}
          className="max-w-[200px] truncate rounded-inner bg-danger/10 px-1.5 py-0.5 font-mono text-meta text-danger line-through decoration-danger/60"
        >
          {f}
        </span>
      ))}
    </div>
  );
}

/**
 * Granted-tool chip row with `+N more` overflow toggle. Same cap rhythm
 * as `FileChips` but tuned smaller since a sub-agent rarely needs more
 * than a handful of distinct tools.
 */
function ToolChips({ tools }: { tools: string[] }) {
  const [expanded, setExpanded] = useState(false);
  if (tools.length === 0) return null;

  const overflowCount = Math.max(0, tools.length - TOOL_CHIP_VISIBLE_CAP);
  const visible = expanded || overflowCount === 0
    ? tools
    : tools.slice(0, TOOL_CHIP_VISIBLE_CAP);

  return (
    <div className="mt-1 flex flex-wrap gap-0.5">
      {visible.map((t) => (
        <span
          key={t}
          title={t}
          className="rounded-inner bg-surface-raised/50 px-1.5 py-0.5 font-mono text-meta text-text-faint"
        >
          {t}
        </span>
      ))}
      {overflowCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className={cn(
            'app-no-drag rounded-inner bg-surface-raised/50 px-1.5 py-0.5 text-meta text-text-muted',
            'transition-colors duration-150 hover:bg-surface-hover hover:text-text-primary'
          )}
        >
          {expanded ? 'show less' : `+${overflowCount} more`}
        </button>
      )}
    </div>
  );
}

/**
 * Click-cycle token-usage chip. Shows one of `current` / `peak` /
 * `cumulative` at a time; clicking advances the cycle. The `title`
 * tooltip always lists all three values so the hidden ones stay
 * discoverable without an expanded menu.
 *
 * `current` is the latest iteration's `prompt + completion`. `peak` is
 * the high-water mark for prompt tokens across the run. `cumulative`
 * is the sum of prompt + completion across every iteration (a rough
 * billing-view proxy).
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
      {/* `current` is the default view — its label is redundant with
          the unadorned count. Only annotate the cycle when the user
          has clicked away to `peak` or `cumulative`, so the typical
          read stays compact. The tooltip still names whatever view
          is showing. */}
      {view !== 'current' && (
        <span className="text-meta text-text-faint">{VIEW_LABEL[view]}</span>
      )}
    </button>
  );
}
