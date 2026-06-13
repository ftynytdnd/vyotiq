/**
 * Model pricing parsed from provider model-list payloads (OpenRouter, etc.).
 * Values are normalized to USD per million tokens for display and cost math.
 */

export interface ModelPricing {
  /** USD per 1M input (prompt) tokens. */
  inputPerMillion?: number;
  /** USD per 1M output (completion) tokens. */
  outputPerMillion?: number;
  /** Fixed USD per request when the upstream charges per call. */
  perRequest?: number;
  /** USD per 1M cached-input read tokens. */
  cachedInputPerMillion?: number;
  /** Anthropic-only: USD per 1M tokens written to the prompt cache. */
  cacheWriteInputPerMillion?: number;
  /** USD per 1M internal reasoning tokens when priced separately. */
  reasoningPerMillion?: number;
}

const ZEROish = new Set(['0', '0.0', '0.00']);

/** Parse a USD-per-token string into USD-per-million tokens. */
export function usdPerTokenToPerMillion(raw: unknown): number | undefined {
  if (raw === null || raw === undefined) return undefined;
  const s = String(raw).trim();
  if (s.length === 0 || ZEROish.has(s)) return 0;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n * 1_000_000;
}

function perMillionFromUsdField(raw: unknown): number | undefined {
  const v = usdPerTokenToPerMillion(raw);
  return v === undefined ? undefined : v;
}

/** Parse OpenRouter-style `pricing` object from a model-list row. */
export function parseModelPricingFromRow(row: unknown): ModelPricing | undefined {
  if (!row || typeof row !== 'object') return undefined;
  const pricing = (row as { pricing?: Record<string, unknown> }).pricing;
  if (!pricing || typeof pricing !== 'object') return undefined;

  const inputPerMillion = perMillionFromUsdField(pricing.prompt ?? pricing.input);
  const outputPerMillion = perMillionFromUsdField(pricing.completion ?? pricing.output);
  const cachedInputPerMillion = perMillionFromUsdField(pricing.input_cache_read);
  const cacheWriteInputPerMillion = perMillionFromUsdField(pricing.input_cache_write);
  const reasoningPerMillion = perMillionFromUsdField(pricing.internal_reasoning);
  const perRequestRaw = pricing.request;
  let perRequest: number | undefined;
  if (perRequestRaw !== undefined && perRequestRaw !== null) {
    const n = Number(String(perRequestRaw).trim());
    if (Number.isFinite(n) && n >= 0) perRequest = n;
  }

  if (
    inputPerMillion === undefined &&
    outputPerMillion === undefined &&
    perRequest === undefined &&
    cachedInputPerMillion === undefined &&
    cacheWriteInputPerMillion === undefined &&
    reasoningPerMillion === undefined
  ) {
    return undefined;
  }

  const out: ModelPricing = {};
  if (inputPerMillion !== undefined) out.inputPerMillion = inputPerMillion;
  if (outputPerMillion !== undefined) out.outputPerMillion = outputPerMillion;
  if (perRequest !== undefined) out.perRequest = perRequest;
  if (cachedInputPerMillion !== undefined) out.cachedInputPerMillion = cachedInputPerMillion;
  if (cacheWriteInputPerMillion !== undefined) {
    out.cacheWriteInputPerMillion = cacheWriteInputPerMillion;
  }
  if (reasoningPerMillion !== undefined) out.reasoningPerMillion = reasoningPerMillion;
  return out;
}

/**
 * Merge pricing with provider-first precedence: primary wins per field;
 * fallback fills only missing or zero fields.
 */
export function mergeModelPricing(
  primary: ModelPricing | undefined,
  fallback: ModelPricing | undefined
): ModelPricing | undefined {
  if (!primary && !fallback) return undefined;
  if (!primary) return fallback ? { ...fallback } : undefined;
  if (!fallback) return { ...primary };

  const out: ModelPricing = { ...primary };
  const fields: (keyof ModelPricing)[] = [
    'inputPerMillion',
    'outputPerMillion',
    'perRequest',
    'cachedInputPerMillion',
    'cacheWriteInputPerMillion',
    'reasoningPerMillion'
  ];
  for (const field of fields) {
    const current = out[field];
    const fb = fallback[field];
    if ((current === undefined || current <= 0) && fb !== undefined && fb > 0) {
      out[field] = fb;
    }
  }
  return out;
}

/** Compact badge label, e.g. `$2/$12` (input/output per M). */
export function formatModelPricingBadge(pricing: ModelPricing | undefined): string | null {
  if (!pricing) return null;
  const inP = pricing.inputPerMillion;
  const outP = pricing.outputPerMillion;
  if (
    (inP === undefined || inP === 0) &&
    (outP === undefined || outP === 0) &&
    (pricing.perRequest === undefined || pricing.perRequest === 0)
  ) {
    if (inP === 0 && outP === 0) return 'Free';
    return null;
  }
  if (inP === undefined && outP === undefined) {
    if (pricing.perRequest !== undefined && pricing.perRequest > 0) {
      return `$${formatUsdCompact(pricing.perRequest)}/req`;
    }
    return null;
  }
  const left = inP !== undefined ? `$${formatUsdCompact(inP)}` : '—';
  const right = outP !== undefined ? `$${formatUsdCompact(outP)}` : '—';
  return `${left}/${right}`;
}

/** Side-panel detail line. */
export function formatModelPricingDetail(pricing: ModelPricing): string {
  const parts: string[] = [];
  if (pricing.inputPerMillion !== undefined) {
    parts.push(`In $${formatUsdDetail(pricing.inputPerMillion)}/M`);
  }
  if (pricing.outputPerMillion !== undefined) {
    parts.push(`Out $${formatUsdDetail(pricing.outputPerMillion)}/M`);
  }
  if (pricing.cachedInputPerMillion !== undefined && pricing.cachedInputPerMillion > 0) {
    parts.push(`Cache read $${formatUsdDetail(pricing.cachedInputPerMillion)}/M`);
  }
  if (pricing.reasoningPerMillion !== undefined && pricing.reasoningPerMillion > 0) {
    parts.push(`Reasoning $${formatUsdDetail(pricing.reasoningPerMillion)}/M`);
  }
  if (pricing.perRequest !== undefined && pricing.perRequest > 0) {
    parts.push(`$${formatUsdDetail(pricing.perRequest)}/request`);
  }
  return parts.length > 0 ? parts.join(' · ') : 'Pricing unavailable';
}

function formatUsdCompact(n: number): string {
  if (n >= 100) return n.toFixed(0);
  if (n >= 10) return n.toFixed(1);
  if (n >= 1) return n.toFixed(2);
  if (n >= 0.01) return n.toFixed(2);
  return n.toPrecision(2);
}

function formatUsdDetail(n: number): string {
  if (n >= 1) return n.toFixed(2);
  if (n >= 0.01) return n.toFixed(3);
  return n.toPrecision(3);
}
