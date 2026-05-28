/**
 * Wire breakdown row inside the Context Inspector (Phase 5 — 2026).
 *
 * Surfaces the per-part split that drives the headline token total:
 *
 *   System prompt + envelopes ─ 18.4k  ▓▓░░░░░░░░░░░░ 14%
 *   Tool schemas               ─  3.1k  ▓░░░░░░░░░░░░░  2%
 *   Message bodies             ─ 14.7k  ▓▓▓░░░░░░░░░░░ 11%
 *   ────────────────────
 *   Total                       36.2k / 128k        28%
 *
 * Reads `snapshot.framing` populated by the main-side
 * `getInspectorSnapshot` (which calls `tokenizeMessages` for the
 * full prospective payload). No IPC of its own — the breakdown
 * tracks the same source as `UsageBadge`.
 *
 * Hidden when every part is zero (a fresh conversation with no
 * harness loaded yet, an edge case).
 *
 * Visual contract: matches `WorkspaceOverridesSection` (Settings →
 * Context) and the trigger bar — flat rows under a single
 * `border-b border-border-subtle/40 py-3` block, no card-in-card.
 * Bar tones reuse the same accent / warning / danger ramp the
 * composer pill applies.
 */

import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import {
  chromeMeterClassName,
  chromeProgressTrackClassName
} from '../ui/SurfaceShell.js';
import type { ContextInspectorSnapshot } from '@shared/types/contextSummary.js';
import type { TokenUsage } from '@shared/types/chat.js';
import { Eyebrow } from '../ui/Eyebrow.js';
import { formatTokenCount } from '../../lib/formatTokens.js';
import { cn } from '../../lib/cn.js';
import { formatCacheBreakdown, formatTokensPerSecond } from './inspectorFormat.js';

interface WireBreakdownProps {
  snapshot: ContextInspectorSnapshot;
  /**
   * Phase 11 (2026) — most-recent-turn `peak` usage (from
   * `useChatStore`'s `orchestratorUsage.peak`). Surfaces optional
   * dialect-specific token breakdowns (`cached`, `cache write`,
   * `reasoning` — OpenAI's `prompt_tokens_details.cached_tokens` /
   * `completion_tokens_details.reasoning_tokens` and Anthropic's
   * `cache_read_input_tokens` / `cache_creation_input_tokens`) as
   * inline pills below the Total row. Omitted fields hide.
   * Undefined when the conversation has no completed turn yet.
   *
   * Scoped to the orchestrator's context window only — sub-agent
   * usage is reported under each sub-agent's trace card via its
   * own `SubAgentSnapshot.usage`. Mirrors the per-window invariant
   * the composer pill, `LiveStatusRow`, and dock peak badges
   * badge also follow.
   */
  peakUsage?: TokenUsage;
  /**
   * Phase 12 (2026) — wall-clock window for the tok/s pill. Computed
   * as `peak.completionTokens / ((streamEndedAt - streamStartedAt) /
   * 1000)`. Hidden by `formatTokensPerSecond` for non-streaming
   * providers and pre-usage moments.
   */
  streamStartedAt?: number;
  streamEndedAt?: number;
}

export function WireBreakdown({
  snapshot,
  peakUsage,
  streamStartedAt,
  streamEndedAt
}: WireBreakdownProps) {
  const { framing, ceiling } = snapshot;
  const { systemPromptTokens, toolSchemaTokens, bodyTokens, total } = framing;
  if (total === 0) return null;
  const breakdown = formatCacheBreakdown(peakUsage);
  const toks = formatTokensPerSecond(
    peakUsage?.completionTokens,
    streamStartedAt,
    streamEndedAt
  );
  // Ratios drive the bar widths. When `ceiling` is unknown we scale
  // the bars relative to the largest part so the visualization still
  // reads — same fallback pattern the existing Inspector + pill
  // surfaces use when a model has no `/v1/models` context_length.
  const denom = typeof ceiling === 'number' && ceiling > 0 ? ceiling : total;
  const envelopes = framing.envelopes;
  // Toggle for the foldable per-envelope breakdown of the system
  // prompt row. Closed by default — the lumped row carries the
  // "is my context filling up" signal; the sub-rows are debugger-
  // grade ("which envelope is bloating the budget"). When the
  // snapshot didn't compute envelopes (legacy build / no system
  // message), the row stays non-foldable.
  const [envelopesOpen, setEnvelopesOpen] = useState(false);
  const canFoldEnvelopes =
    Array.isArray(envelopes) && envelopes.length > 0;
  const totalRatio = denom > 0 ? Math.min(1, total / denom) : 0;
  const totalPct = Math.round(totalRatio * 100);
  return (
    <div className="flex flex-col gap-2 border-b border-border-subtle/40 py-3">
      <div className="flex items-center justify-between gap-2">
        <Eyebrow as="span" bold>
          Wire breakdown
        </Eyebrow>
        <span className="text-meta text-text-muted">
          What the next request will carry
        </span>
      </div>
      <ul className="flex flex-col gap-1">
        <BreakdownRow
          label="System prompt + envelopes"
          value={systemPromptTokens}
          denom={denom}
          {...(canFoldEnvelopes
            ? {
              expandable: true,
              expanded: envelopesOpen,
              onToggle: () => setEnvelopesOpen((v) => !v)
            }
            : {})}
        />
        {canFoldEnvelopes && envelopesOpen && envelopes && (
          <li>
            <ul className="ml-5 flex flex-col gap-1 border-l border-border-subtle/30 pl-3 pt-1">
              {envelopes.map((env) => (
                <BreakdownRow
                  key={env.label}
                  label={env.label}
                  value={env.tokens}
                  denom={denom}
                  nested
                />
              ))}
            </ul>
          </li>
        )}
        <BreakdownRow label="Tool schemas" value={toolSchemaTokens} denom={denom} />
        <BreakdownRow label="Message bodies" value={bodyTokens} denom={denom} />
      </ul>
      <div className="flex items-baseline justify-between gap-2 border-t border-border-subtle/30 pt-2">
        <span className="text-row text-text-secondary">Total</span>
        <span
          className={cn(
            'flex items-baseline gap-2 font-mono text-row',
            'text-text-primary'
          )}
        >
          {formatTokenCount(total)}
          {typeof ceiling === 'number' && (
            <span className="text-text-faint">/ {formatTokenCount(ceiling)}</span>
          )}
          <span className="text-text-muted">
            {totalRatio > 0 && totalPct === 0 ? '<1%' : `${totalPct}%`}
          </span>
        </span>
      </div>
      {(breakdown.length > 0 || toks !== null) && (
        // Phase 11 (2026) — dialect-specific token breakdown surfaces
        // here as a horizontal pill row. Each pill represents a
        // signal that's typically invisible: cached prompt tokens
        // (cost savings), cache-write tokens (premium-priced), and
        // reasoning tokens (latency / cost driver on thinking
        // models). The row only appears when the most-recent turn
        // reported at least one of these; non-thinking, uncached
        // turns hide the row entirely so non-Anthropic / non-Gemini
        // dialects don't pay for the visual real estate.
        // Phase 12 (2026) — when the run reported usage AND has a
        // measurable streaming window, an additional tok/s pill
        // joins the row so the user can compare throughput across
        // models without leaving the panel.
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <span className="text-meta text-text-faint">Last turn:</span>
          {breakdown.map((entry) => (
            <span
              key={entry.key}
              className={cn(
                'inline-flex items-baseline gap-1 rounded-inner px-1.5 py-0.5 text-meta font-mono',
                entry.key === 'cached'
                  ? 'bg-success/10 text-success'
                  : entry.key === 'cache-write'
                    ? 'bg-warning/10 text-warning'
                    : 'bg-accent/10 text-accent'
              )}
              title={
                entry.key === 'cached'
                  ? 'Prompt tokens served from a warm provider cache (Anthropic prompt-caching, OpenAI prefix caching, Gemini context caching). These are billed at a steep discount.'
                  : entry.key === 'cache-write'
                    ? 'Prompt tokens that primed the provider cache for the FIRST time on this request. Anthropic charges these at a 25% premium relative to a normal prompt token; subsequent reads are 90% cheaper.'
                    : 'Hidden chain-of-thought tokens generated by the thinking model. Counted toward the completion budget and billed at the completion-token rate even though they never appear in the visible output.'
              }
            >
              <span className="text-text-faint">·</span>
              <span>{formatTokenCount(entry.value)}</span>
              <span className="text-text-secondary">{entry.label}</span>
            </span>
          ))}
          {toks !== null && (
            <span
              className={chromeMeterClassName(
                'items-baseline gap-1 px-1.5 py-0.5 text-text-secondary'
              )}
              title="Completion-token throughput, measured from the first streamed delta to the latest authoritative usage frame. Excludes hidden chain-of-thought tokens so the rate matches the typing speed perceived in the stream."
            >
              <span className="text-text-faint">·</span>
              <span>{toks}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

interface BreakdownRowProps {
  label: string;
  value: number;
  denom: number;
  /**
   * When `true`, the row renders a chevron + becomes a clickable
   * surface that toggles the foldable sub-list. The caller owns the
   * `expanded` state and the `onToggle` handler so multiple rows
   * can fold independently. The chevron rotates open/closed in step
   * with `expanded`.
   */
  expandable?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  /**
   * Indented sub-row variant rendered inside an expanded foldable
   * group. Slimmer chrome (smaller label width, muted bar tone) so
   * the visual hierarchy reads sub-row vs row at a glance. Sub-rows
   * are NEVER themselves expandable today — the foldable surface
   * sits at one level only.
   */
  nested?: boolean;
}

/**
 * Single row in the breakdown — label, monospace count, inline bar,
 * pct%. The bar's width is scaled to `denom` (the ceiling when
 * known, otherwise the total). Zero-valued rows render at zero
 * width but remain visible so the user sees the structural slot.
 *
 * When `expandable` is set, the row becomes a `<button>` that
 * toggles the caller-owned fold state. The chevron rotates 90°
 * to mirror the existing `ContextSummaryRow` / `ToolGroupRow`
 * pattern so the gesture feels native to users who already know
 * the timeline-card chevrons.
 */
function BreakdownRow({
  label,
  value,
  denom,
  expandable,
  expanded,
  onToggle,
  nested
}: BreakdownRowProps) {
  const ratio = denom > 0 ? Math.min(1, value / denom) : 0;
  const pct = Math.round(ratio * 100);
  const pctLabel = ratio > 0 && pct === 0 ? '<1%' : `${pct}%`;
  const barWidth = `${Math.min(100, pct)}%`;
  // Visual rhythm:
  //   - Top-level row: 160px label slot, primary text tone.
  //   - Nested sub-row: 140px label slot (sub-rows already sit inside
  //     a `pl-3` indent, so the narrower slot lines the bars up with
  //     the parent row instead of pushing them off the right edge).
  //     The bar uses `accent/40` instead of `accent/60` so the
  //     hierarchy reads as visually quieter.
  const labelMin = nested ? 'min-w-[140px]' : 'min-w-[160px]';
  const labelTone = nested ? 'text-text-muted' : 'text-text-secondary';
  const barTone = nested ? 'bg-accent/40' : 'bg-accent/60';
  // Chevron slot:
  //   - Expandable rows render the rotating chevron icon.
  //   - Non-expandable TOP-LEVEL rows reserve the same width with an
  //     empty placeholder so every top-level label starts at the
  //     same x-coordinate (Tool schemas / Message bodies line up
  //     under "System prompt + envelopes").
  //   - Nested sub-rows render NO slot — their parent <ul>'s
  //     `ml-5 pl-3` already provides the visual indent that
  //     distinguishes them from the parent row.
  const chevronSlot = expandable ? (
    <ChevronRight
      className={cn(
        'h-3 w-3 shrink-0 text-chevron transition-transform duration-150',
        expanded ? 'rotate-90' : 'rotate-0'
      )}
      strokeWidth={2}
      aria-hidden
    />
  ) : nested ? null : (
    <span className="h-3 w-3 shrink-0" aria-hidden />
  );
  const rowInner = (
    <>
      {chevronSlot}
      <span className={cn('flex-shrink-0', labelMin, labelTone)}>{label}</span>
      <span className="w-14 flex-shrink-0 text-right font-mono text-text-primary">
        {formatTokenCount(value)}
      </span>
      <span
        aria-hidden
        className={chromeProgressTrackClassName}
      >
        <span
          className={cn('absolute left-0 top-0 h-full rounded-pill', barTone)}
          style={{ width: barWidth }}
        />
      </span>
      <span className="w-10 flex-shrink-0 text-right font-mono text-text-muted">
        {pctLabel}
      </span>
    </>
  );
  if (expandable) {
    return (
      <li>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded === true}
          className="app-no-drag flex w-full cursor-pointer items-center gap-2 rounded-inner text-left text-row transition-colors duration-150 hover:bg-surface-hover/40"
        >
          {rowInner}
        </button>
      </li>
    );
  }
  return <li className="flex items-center gap-2 text-row">{rowInner}</li>;
}
