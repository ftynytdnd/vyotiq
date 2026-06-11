/**
 * Deterministic JSON serialization with recursively sorted object keys.
 * Identical logical values produce byte-identical strings regardless of
 * key insertion order — required for stable LLM prompt prefixes.
 */

function sortValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sortValue);
  const obj = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = sortValue(obj[key]);
  }
  return sorted;
}

/** JSON.stringify with recursively sorted object keys. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}
