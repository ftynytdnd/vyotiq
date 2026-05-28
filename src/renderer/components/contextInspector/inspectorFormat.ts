/**
 * Pure formatting helpers shared by the Context Inspector subcomponents.
 *
 * Centralised here so every row/header/footer agrees on the same
 * casing, percent rounding, and label vocabulary — rather than each
 * subcomponent reinventing its own number formatting against the
 * snapshot fields. None of these touch React state or IPC; they're
 * cheap to call inline from a render path.
 */

import type {
  ContextInspectorMessage,
  MessageKind
} from '@shared/types/contextSummary.js';
import type { TokenUsage } from '@shared/types/chat.js';

/**
 * Render a snapshot ratio (0..2 — `currentRatio` clamps the over-budget
 * red zone) as a 0..1-decimal-place percentage string. The
 * `TokenUsagePill` rounds to whole percents because its surface is
 * tiny; the Inspector's footer has space for one decimal so the user
 * can tell `69.4 %` (still under the 70 % auto-trigger) from
 * `69.6 %` (already past) at a glance.
 */
export function formatRatioPercent(ratio: number | undefined): string {
  if (typeof ratio !== 'number' || !Number.isFinite(ratio)) return '—';
  const pct = ratio * 100;
  if (ratio > 0 && pct < 0.1) return '<0.1%';
  return `${pct.toFixed(1)}%`;
}

/**
 * Compute the band the snapshot's current ratio sits in. Used by the
 * gauge bar + footer to pick a tone. Mirrors the `TokenUsagePill`'s
 * thresholds so the Inspector and the pill agree on "amber" / "red".
 */
export function ratioBand(
  ratio: number | undefined
): 'safe' | 'warn' | 'danger' {
  if (typeof ratio !== 'number') return 'safe';
  if (ratio >= 0.9) return 'danger';
  if (ratio >= 0.7) return 'warn';
  return 'safe';
}

/**
 * One-word human label for a `MessageKind`, used in the Rules Header's
 * per-kind policy table. Capitalised + space-separated where the raw
 * enum is hyphenated. Returns the raw enum for any unknown future
 * variant (defensive — a `never` here would crash at render time on a
 * settings file authored by a newer build).
 */
export function labelForKind(kind: MessageKind): string {
  switch (kind) {
    case 'user':
      return 'User prompt';
    case 'assistant':
      return 'Assistant text';
    case 'assistant-tool-call':
      return 'Assistant tool call';
    case 'tool-result':
      return 'Tool result';
    case 'delegate-result':
      return 'Delegate result';
    case 'system-summary':
      return 'Compressed summary';
    default: {
      const _exhaustive: never = kind;
      void _exhaustive;
      return kind as string;
    }
  }
}

/**
 * Sum the token estimates for every message that meets the predicate.
 * Used by the trigger bar's "Summarize now (≈X → Y tokens)" projection
 * — the projection is pure UI polish so we keep it dependency-free.
 */
export function sumTokens(
  messages: ReadonlyArray<ContextInspectorMessage>,
  predicate: (m: ContextInspectorMessage) => boolean
): number {
  let total = 0;
  for (const m of messages) {
    if (predicate(m)) total += m.tokenEstimate;
  }
  return total;
}

/**
 * Project the post-summarization token cost. We can't know the actual
 * compressed body length until the summarizer streams, so we use a
 * conservative "10 % of the summarizable range survives, plus
 * preserved tokens" heuristic that matches the order of magnitude the
 * summarizer typically produces. The Inspector renders this as
 * `~Y tokens` with a tilde so the user reads it as approximate.
 */
export function projectAfterTokens(
  messages: ReadonlyArray<ContextInspectorMessage>
): number {
  const preservedTokens = sumTokens(messages, (m) => m.effectiveDecision === 'keep');
  const summarizableTokens = sumTokens(
    messages,
    (m) => m.effectiveDecision === 'summarize'
  );
  // Dropped messages survive only as placeholder markers (or not at
  // all — the marker style is controlled by the rules), so they
  // contribute zero to the projection.
  return Math.round(preservedTokens + summarizableTokens * 0.1);
}

/**
 * One pill on the WireBreakdown footer (and the SubAgentHeader
 * tooltip). Each entry surfaces an OPTIONAL token-usage field that
 * not every dialect reports:
 *
 *   - `cached`       — `cachedPromptTokens` (Anthropic
 *                       `cache_read_input_tokens`, OpenAI/xAI
 *                       `prompt_tokens_details.cached_tokens`,
 *                       Gemini `cachedContentTokenCount`).
 *                       Strongly negative-cost signal: a high
 *                       cached-token count means most of the
 *                       prompt is being served from a warm cache.
 *
 *   - `cache write`  — `cacheCreationTokens` (Anthropic
 *                       `cache_creation_input_tokens`). Premium
 *                       priced relative to a normal prompt token,
 *                       so seeing it explicitly helps the user
 *                       understand a "this turn cost more than
 *                       usual" surprise.
 *
 *   - `reasoning`    — `reasoningTokens` (OpenAI/xAI/DeepSeek
 *                       `completion_tokens_details.reasoning_tokens`,
 *                       Gemini `thoughtsTokenCount`). Useful when
 *                       comparing two turns' visible-output sizes:
 *                       a turn with 2k visible + 8k reasoning has
 *                       very different latency + cost than a turn
 *                       with 10k visible + 0k reasoning.
 *
 * Returns the entries in display order, OMITTING any field that
 * the dialect didn't report (so a non-thinking turn doesn't show
 * a "0 reasoning" pill that just adds noise). Pure formatter; the
 * caller picks the rendered shape (pill, dotted list, etc).
 */
export interface CacheBreakdownEntry {
  /** Stable key for React; also used as a CSS class hint by callers. */
  key: 'cached' | 'cache-write' | 'reasoning';
  /** Lower-case display label (`cached`, `cache write`, `reasoning`). */
  label: string;
  /** Raw token count — the caller decides how to format it. */
  value: number;
}
export function formatCacheBreakdown(
  usage: TokenUsage | undefined
): CacheBreakdownEntry[] {
  if (!usage) return [];
  const out: CacheBreakdownEntry[] = [];
  if (typeof usage.cachedPromptTokens === 'number' && usage.cachedPromptTokens > 0) {
    out.push({ key: 'cached', label: 'cached', value: usage.cachedPromptTokens });
  }
  if (typeof usage.cacheCreationTokens === 'number' && usage.cacheCreationTokens > 0) {
    out.push({ key: 'cache-write', label: 'cache write', value: usage.cacheCreationTokens });
  }
  if (typeof usage.reasoningTokens === 'number' && usage.reasoningTokens > 0) {
    out.push({ key: 'reasoning', label: 'reasoning', value: usage.reasoningTokens });
  }
  return out;
}

/**
 * Phase 12 (2026) — completion-token throughput readout. Returns
 * `null` when any of the inputs is missing or the elapsed window is
 * implausibly short (< 250 ms — typically a non-streaming provider
 * that reported usage in the same frame as the first delta, where
 * tok/s would explode to a meaningless huge number).
 *
 * Rounding:
 *   - 3 sig-figs under 100 tok/s so the number stays informative on
 *     the slow end (e.g. `83.5 tok/s` for a thinking model).
 *   - Whole-number above 100 (`245 tok/s`) — sub-decimal precision
 *     is noise above that range and consumes pill real estate.
 *
 * The label `tok/s` (not `tokens/s` or `tps`) matches the convention
 * already used inside `LiveStatusRow` and the existing on-stream
 * estimator so the user sees the same units across surfaces.
 */
export function formatTokensPerSecond(
  completionTokens: number | undefined,
  startedAt: number | undefined,
  endedAt: number | undefined
): string | null {
  if (typeof completionTokens !== 'number' || completionTokens <= 0) return null;
  if (typeof startedAt !== 'number' || typeof endedAt !== 'number') return null;
  const elapsedMs = endedAt - startedAt;
  if (elapsedMs < 250) return null;
  const rate = completionTokens / (elapsedMs / 1000);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  if (rate < 100) {
    return `${rate.toFixed(1)} tok/s`;
  }
  return `${Math.round(rate)} tok/s`;
}
