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
import {
  formatCacheBreakdown,
  formatTokensPerSecond
} from '../../contextInspector/inspectorFormat.js';
import { shimmerPill, shimmerStyle, shimmerText } from '../../../lib/shimmer.js';
import { useChatStore } from '../../../store/useChatStore.js';
import {
  useProviderStore,
  selectEffectiveContextWindow
} from '../../../store/useProviderStore.js';

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
  // T1-6: `partial` gets the existing warning tone tokens, mirroring
  // how `SubAgentResult.tsx` already paints the `<status>partial`
  // envelope status. Live states (pending / running) keep their accent
  // tone for shimmer continuity.
  const statusPillClass =
    snap.status === 'done'
      ? 'bg-success-soft text-success'
      : snap.status === 'partial'
        ? 'bg-warning-soft text-warning'
        : snap.status === 'malformed'
          ? 'bg-warning-soft text-warning'
          : snap.status === 'failed' || snap.status === 'aborted'
            ? 'bg-danger-soft text-danger'
            : 'bg-accent-soft text-accent';

  return (
    <div className="flex items-start gap-2">
      <Bot className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-faint" strokeWidth={2} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5 text-row text-text-muted">
          <span className="font-medium text-text-secondary">Sub-agent {snap.id}</span>
          <span
            className={cn(
              'rounded-inner px-1.5 py-0.5 text-meta font-medium capitalize',
              'inline-flex h-6 items-center',
              statusPillClass
            )}
          >
            <span
              className={shimmerPill(isLive)}
              style={isLive ? shimmerStyle(`subagent-pill:${snap.id}`) : undefined}
            >
              {snap.status}
            </span>
          </span>
          {snap.usage && <SubAgentUsagePill usage={snap.usage} />}
          {snap.usage && <SubAgentContextChip usage={snap.usage} subagentId={snap.id} />}
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

  // Phase 11 (2026): surface the dialect-specific token breakdown
  // (cached / cache-write / reasoning) on the same hover. Anthropic
  // emits `cached` + `cache write`; Gemini emits `cached` +
  // `reasoning`; OpenAI o-series emits `reasoning`. Non-thinking
  // OpenAI / Ollama turns omit them entirely so the tooltip stays
  // short. We use `peak` as the source so a long completed turn's
  // breakdown stays visible after `latest` rolls over.
  const breakdown = formatCacheBreakdown(usage.peak);
  const breakdownLine =
    breakdown.length > 0
      ? '\n' +
      breakdown
        .map((b) => `  · ${b.value.toLocaleString()} ${b.label}`)
        .join('\n')
      : '';
  // Phase 12 (2026): tok/s throughput readout. We use `peak`
  // completion tokens against the full stream window
  // (`streamStartedAt` → `streamEndedAt`) so a multi-iteration
  // worker's pill stays representative of the run-level rate, not
  // the last iteration alone. Hidden by `formatTokensPerSecond`
  // for non-streaming providers (elapsed < 250 ms) and pre-usage
  // moments — the visible tooltip simply skips the line then.
  const toks = formatTokensPerSecond(
    usage.peak.completionTokens,
    usage.streamStartedAt,
    usage.streamEndedAt
  );
  const toksLine = toks !== null ? `\n· ${toks}` : '';
  const tooltip =
    `Current ${current.toLocaleString()} · ` +
    `Peak ${peak.toLocaleString()} · ` +
    `Cumulative ${cumulative.toLocaleString()} tokens ` +
    `(click to cycle — showing ${VIEW_LABEL[view]})` +
    toksLine +
    breakdownLine;

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
        'inline-flex h-6 items-center gap-1 rounded-inner bg-surface-overlay px-1.5 text-meta text-text-faint',
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

/**
 * Phase 6 (2026) — ceiling-aware sub-agent context chip.
 *
 * Displays `<pct>% ctx` for the worker's prompt-token-to-ceiling
 * ratio so a sub-agent approaching its own context window is
 * visible at-a-glance from the trace header without expanding the
 * usage pill. Same tone ramp as the composer pill (amber 70%, red
 * 90%) for visual continuity.
 *
 * Resolution order for the ceiling:
 *   1. The active orchestrator run's modelId (from `runIdToModel`)
 *      → `selectEffectiveContextWindow(providerId, modelId)`. Most
 *      runs share the orchestrator's model.
 *   2. The active slice's `meta.lastModelId` + `lastProviderId`
 *      (idle / historical traces — dock peak badge path).
 *   3. Hidden when no ceiling can be resolved.
 *
 * Sub-agents that override the orchestrator's model via
 * `<delegate model="…" />` would currently render with the
 * orchestrator's ceiling; a future extension can persist the
 * worker's model on the snapshot. Cheap to add when the wire
 * carries it; for now the chip is "best-effort ceiling" and the
 * `title` tooltip cites which model it resolved against.
 */
function SubAgentContextChip({
  usage,
  subagentId
}: {
  usage: TokenUsageAggregate;
  subagentId: string;
}) {
  const runId = useChatStore((s) => s.runId);
  const runIdToModel = useChatStore((s) => s.runIdToModel);
  const providers = useProviderStore((s) => s.providers);

  // Sub-agent runs share the orchestrator's runId; pick its modelId.
  const modelId = runId ? runIdToModel[runId] : undefined;
  // We don't store the providerId on the runIdToModel map (only
  // modelId), so we walk providers to find the matching one. This is
  // O(providers) per render but the list is small (typically ≤ 5
  // configured providers).
  let ceiling: number | undefined;
  if (modelId) {
    for (const p of providers) {
      const c = selectEffectiveContextWindow(providers, p.id, modelId);
      if (typeof c === 'number') {
        // Prefer the FIRST provider that has a ceiling stamped for
        // this modelId. The runtime would route through one of them;
        // ceilings rarely differ across the same id.
        ceiling = c;
        break;
      }
    }
  }

  // No ceiling → hide the chip entirely. The standalone usage pill
  // next to it still shows raw token counts, so the user isn't
  // missing data.
  if (typeof ceiling !== 'number' || ceiling <= 0) return null;
  // Pre-usage state (no prompt tokens reported yet) → hide. Avoids
  // showing `0%` on a worker that just spawned and hasn't streamed.
  if (usage.latest.promptTokens <= 0) return null;

  const ratio = Math.min(2, usage.latest.promptTokens / ceiling);
  const pct = Math.round(ratio * 100);
  const pctLabel = ratio > 0 && pct === 0 ? '<1%' : `${pct}%`;
  const toneClass =
    ratio >= 0.9
      ? 'text-danger'
      : ratio >= 0.7
        ? 'text-warning'
        : 'text-text-faint';
  const tooltip =
    `Worker ${subagentId}: ${usage.latest.promptTokens.toLocaleString()} prompt tokens ` +
    `/ ${ceiling.toLocaleString()} ceiling (${modelId ?? 'unknown model'}). ` +
    `Sub-agent is using ${pctLabel} of its context window.`;
  return (
    <span
      title={tooltip}
      className={cn(
        'inline-flex h-6 items-center rounded-inner bg-surface-overlay px-1.5 text-meta font-mono',
        toneClass
      )}
    >
      {pctLabel} ctx
    </span>
  );
}
