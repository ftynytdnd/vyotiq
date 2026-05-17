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
 * Short tone label for the row's effective decision. Used inside the
 * `MessageRow`'s 3-state segmented toggle to label the active option
 * without re-implementing capitalisation logic per row.
 */
export function labelForDecision(
  decision: ContextInspectorMessage['effectiveDecision']
): string {
  switch (decision) {
    case 'keep':
      return 'Keep';
    case 'summarize':
      return 'Summarize';
    case 'drop':
      return 'Drop';
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
