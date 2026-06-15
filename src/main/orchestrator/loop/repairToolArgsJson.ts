/**
 * Best-effort repair for truncated streaming tool-call argument JSON.
 * Observed when models emit many parallel calls in one turn and one
 * argument buffer lands without a closing quote/brace.
 */

const MAX_REPAIR_STEPS = 8;

/**
 * Attempt to close a truncated JSON object. Returns a parsed record on
 * success, or `null` when repair is unsafe or impossible.
 */
export function tryRepairTruncatedToolArgsRecord(
  buf: string
): Record<string, unknown> | null {
  let attempt = buf.trim();
  if (!attempt.startsWith('{')) return null;

  for (let step = 0; step < MAX_REPAIR_STEPS; step++) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(attempt);
    } catch (err) {
      if (!(err instanceof SyntaxError)) return null;
      const detail = err.message;
      if (detail.includes('Unterminated string')) {
        attempt += '"';
        continue;
      }
      if (
        detail.includes('Unexpected end of JSON input') ||
        detail.includes('Expected') ||
        detail.includes('Unterminated')
      ) {
        attempt += '}';
        continue;
      }
      return null;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  }
  return null;
}
