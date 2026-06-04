/**
 * Shared parsing for `delegate` tool arguments (orchestrator).
 */

import type { ParsedDelegate } from '../envelope/index.js';
import { coerceStringList, parseDependsOnIds } from './toolDependencyBatches.js';
import { tryParseArgumentsUnknown } from './parseToolArgs.js';

/** Last spec wins when the model repeats the same `id` in one turn. */
export function dedupeDelegateSpecsById(specs: ParsedDelegate[]): ParsedDelegate[] {
  const byId = new Map<string, ParsedDelegate>();
  for (const s of specs) {
    byId.set(s.id, s);
  }
  return Array.from(byId.values());
}

function specFromObject(obj: Record<string, unknown>): ParsedDelegate | null {
  const id = typeof obj['id'] === 'string' ? obj['id'].trim() : '';
  const task = typeof obj['task'] === 'string' ? obj['task'].trim() : '';
  if (!id || !task) return null;
  const rawConcurrency = obj['concurrency'] ?? obj['max_parallel'];
  const concurrency =
    typeof rawConcurrency === 'number' && Number.isFinite(rawConcurrency) && rawConcurrency > 0
      ? Math.floor(rawConcurrency)
      : undefined;
  return {
    id,
    task,
    files: coerceStringList(obj['files']),
    tools: coerceStringList(obj['tools']),
    ...(concurrency !== undefined ? { concurrency } : {})
  };
}

function roundConcurrencyFromObject(obj: Record<string, unknown>): number | undefined {
  const raw = obj['concurrency'] ?? obj['max_parallel'];
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return Math.floor(raw);
  }
  return undefined;
}

/** Apply batch-level `concurrency` to specs that omitted their own. */
function applyRoundConcurrency(
  specs: ParsedDelegate[],
  roundConcurrency?: number
): ParsedDelegate[] {
  if (roundConcurrency === undefined) return specs;
  return specs.map((s) =>
    s.concurrency !== undefined ? s : { ...s, concurrency: roundConcurrency }
  );
}

export function coerceDelegateSpecsFromParsed(parsed: unknown): ParsedDelegate[] {
  const fromArray = (arr: unknown[]): ParsedDelegate[] =>
    arr
      .filter(
        (x): x is Record<string, unknown> =>
          x !== null && typeof x === 'object' && !Array.isArray(x)
      )
      .map(specFromObject)
      .filter((s): s is ParsedDelegate => s !== null);

  if (Array.isArray(parsed)) return fromArray(parsed);
  if (parsed === null || typeof parsed !== 'object') return [];
  const obj = parsed as Record<string, unknown>;
  const roundConcurrency = roundConcurrencyFromObject(obj);
  const single = specFromObject(obj);
  if (single) return applyRoundConcurrency([single], roundConcurrency);
  for (const key of ['delegates', 'tasks', 'items', 'specs']) {
    const arr = obj[key];
    if (Array.isArray(arr)) {
      const specs = fromArray(arr);
      if (specs.length > 0) return applyRoundConcurrency(specs, roundConcurrency);
    }
  }
  return [];
}

export function parseDelegateCallMeta(argsBuf: string): {
  specs: ParsedDelegate[];
  dependsOn: string[];
} {
  const parsed = tryParseArgumentsUnknown(argsBuf);
  const dependsOn =
    parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parseDependsOnIds(parsed as Record<string, unknown>)
      : [];
  return { specs: coerceDelegateSpecsFromParsed(parsed), dependsOn };
}
