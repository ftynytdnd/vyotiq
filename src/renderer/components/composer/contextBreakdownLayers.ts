import type { ContextUsageBreakdown } from '@shared/context/contextLevel.js';

/** Ordered layers for display (static prefix → volatile tail → tools). */
export const CONTEXT_BREAKDOWN_LAYERS: ReadonlyArray<{
  key: keyof ContextUsageBreakdown;
  label: string;
  title: string;
}> = [
  { key: 'system', label: 'System', title: 'Harness and agent meta-rules' },
  { key: 'workspace', label: 'Workspace', title: 'Project listing and workspace envelope' },
  { key: 'history', label: 'History', title: 'Prior turns, tool calls, and results' },
  { key: 'runtime', label: 'Runtime', title: 'Host environment, session, run state, and memory' },
  { key: 'turn', label: 'Turn', title: 'Current user message and attachments' },
  { key: 'tools', label: 'Tools', title: 'Tool schema catalogue on the wire' }
];

/** Integer percent for a layer relative to a denominator (0..100). */
export function layerShare(tokens: number, total: number): number {
  if (total <= 0 || tokens <= 0) return 0;
  return Math.min(100, Math.round((tokens / total) * 100));
}

/** Share of the model context window (what the meter header % uses). */
export function layerWindowShare(tokens: number, effectiveWindow: number): number {
  return layerShare(tokens, effectiveWindow);
}

/** Share within the current prompt composition (for stacked / row bars). */
export function layerCompositionShare(tokens: number, usedTokens: number): number {
  return layerShare(tokens, usedTokens);
}

/** Fractional composition width (0–100) for row bars — no rounding floor. */
export function layerCompositionBarWidth(tokens: number, usedTokens: number): number {
  if (usedTokens <= 0 || tokens <= 0) return 0;
  return Math.min(100, (tokens / usedTokens) * 100);
}

/** Display percent of model context window; sub-0.5% layers show as `<1%`. */
export function formatLayerWindowPct(tokens: number, effectiveWindow: number): string {
  if (tokens <= 0 || effectiveWindow <= 0) return '0%';
  const pct = (tokens / effectiveWindow) * 100;
  if (pct > 0 && pct < 0.5) return '<1%';
  return `${Math.min(100, Math.round(pct))}%`;
}

/** Footnote when some layers are empty — clarifies static prefix vs history. */
export function formatOmittedLayerNote(
  emptyLabels: string[],
  breakdown: ContextUsageBreakdown
): string | null {
  if (emptyLabels.length === 0) return null;
  const onlyHistory = emptyLabels.length === 1 && emptyLabels[0] === 'History';
  const hasStaticPrefix =
    breakdown.system > 0 || breakdown.tools > 0 || breakdown.runtime > 0;
  if (onlyHistory && hasStaticPrefix) {
    return 'History empty — harness, tools, and runtime count before your first message';
  }
  return `${emptyLabels.join(', ')} empty`;
}

/** Layers with tokens, largest first — for dense breakdown tables. */
export function activeBreakdownLayers(
  breakdown: ContextUsageBreakdown
): Array<(typeof CONTEXT_BREAKDOWN_LAYERS)[number] & { tokens: number }> {
  return CONTEXT_BREAKDOWN_LAYERS.map((layer) => ({
    ...layer,
    tokens: breakdown[layer.key]
  }))
    .filter((layer) => layer.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens);
}

/** Labels of layers that are currently empty (for a one-line footnote). */
export function emptyBreakdownLabels(breakdown: ContextUsageBreakdown): string[] {
  return CONTEXT_BREAKDOWN_LAYERS.filter((layer) => breakdown[layer.key] <= 0).map(
    (layer) => layer.label
  );
}
