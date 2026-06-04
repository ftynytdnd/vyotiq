/**
 * Token count formatters. Shared by the composer usage pill, the
 * composer token pill, and the model-row context-window
 * editor. Kept in `lib/` rather than next to a specific component so
 * all three rendering sites use the same casing.
 */

/**
 * Short form like `128k`, `1.5M`, `640`. One decimal only when needed
 * so `128k` stays `128k` rather than `128.0k`. Values below 1000 are
 * rendered as the raw integer.
 */
export function formatTokenCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)}M`;
  }
  if (n >= 1000) {
    const k = n / 1000;
    return `${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}k`;
  }
  return String(Math.round(n));
}

/** Same as {@link formatTokenCount} with an optional unit suffix (`tok`). */
export function formatTokenCountWithUnit(n: number, unit = 'tok'): string {
  const core = formatTokenCount(n);
  return core === '—' ? core : `${core} ${unit}`;
}

/**
 * Parse a human-entered string into a token count. Accepts raw ints
 * (`128000`), `k` suffix (`128k`, `1.5k`), `m` suffix (`1m`, `1.5M`),
 * with optional whitespace / underscores / commas inside the number.
 * Returns `null` if the value can't be parsed or is non-positive.
 */
export function parseTokenCount(raw: string): number | null {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  const clean = trimmed.replace(/[_,\s]/g, '');
  const m = /^([0-9]+(?:\.[0-9]+)?)([km])?$/.exec(clean);
  if (!m) return null;
  const base = Number.parseFloat(m[1]!);
  if (!Number.isFinite(base) || base <= 0) return null;
  const suffix = m[2];
  const multiplier = suffix === 'm' ? 1_000_000 : suffix === 'k' ? 1_000 : 1;
  const value = Math.floor(base * multiplier);
  return value > 0 ? value : null;
}

/** Completion-token throughput for live status readouts (`83.5 tok/s`). */
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
