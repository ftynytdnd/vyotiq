import type { ContextUsageBreakdown } from '@shared/context/contextLevel.js';

/** Ordered layers for display (static prefix → volatile tail → tools). */
export const CONTEXT_BREAKDOWN_LAYERS: ReadonlyArray<{
  key: keyof ContextUsageBreakdown;
  label: string;
  title: string;
}> = [
  { key: 'system', label: 'System', title: 'Harness and agent meta-rules' },
  { key: 'fewShot', label: 'Few-shot', title: 'Static instruction examples' },
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

/** Share of the usable context window (what the meter header % uses). */
export function layerWindowShare(tokens: number, effectiveWindow: number): number {
  return layerShare(tokens, effectiveWindow);
}

/** Share within the current prompt composition (for stacked / row bars). */
export function layerCompositionShare(tokens: number, usedTokens: number): number {
  return layerShare(tokens, usedTokens);
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
