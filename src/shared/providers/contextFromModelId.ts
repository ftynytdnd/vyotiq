/**
 * Lowest-priority context inference from model id strings (e.g. qwen-128k).
 * Used only when API probes and catalogs omit context metadata.
 */

const NAME_CONTEXT_PATTERNS: ReadonlyArray<{ re: RegExp; multiplier: number }> = [
  { re: /\b(\d+(?:\.\d+)?)\s*m(?:illion)?\b/i, multiplier: 1_000_000 },
  { re: /\b(\d+(?:\.\d+)?)\s*b(?:illion)?\b/i, multiplier: 1_000_000_000 },
  { re: /\b(\d+(?:\.\d+)?)\s*k\b/i, multiplier: 1_000 },
  { re: /-(\d+)k(?:-|$)/i, multiplier: 1_000 },
  { re: /_(\d+)k(?:_|$)/i, multiplier: 1_000 },
  { re: /-(\d+)m(?:-|$)/i, multiplier: 1_000_000 },
  { re: /_(\d+)m(?:_|$)/i, multiplier: 1_000_000 }
];

function plausibleContext(n: number): number | undefined {
  if (!Number.isFinite(n)) return undefined;
  const tokens = Math.floor(n);
  if (tokens < 512 || tokens > 10_000_000) return undefined;
  return tokens;
}

/**
 * Infer context window from a model id tail. Returns undefined when no
 * confident pattern matches.
 */
export function contextWindowFromModelId(modelId: string): number | undefined {
  const tail = modelId.includes('/') ? modelId.slice(modelId.lastIndexOf('/') + 1) : modelId;
  for (const { re, multiplier } of NAME_CONTEXT_PATTERNS) {
    const m = tail.match(re);
    if (!m?.[1]) continue;
    const base = Number(m[1]);
    if (!Number.isFinite(base)) continue;
    const ctx = plausibleContext(base * multiplier);
    if (ctx !== undefined) return ctx;
  }
  return undefined;
}
