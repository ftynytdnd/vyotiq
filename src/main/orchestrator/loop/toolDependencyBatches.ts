/**
 * Topological batches for parallel tool execution. Tool calls in the same
 * batch have no unresolved `depends_on` edges; batches run sequentially.
 */

import { logger } from '../../logging/logger.js';

const log = logger.child('orch/toolDeps');

/** Coerce model tool args from an array or comma-separated string. */
export function coerceStringList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .filter((x): x is string => typeof x === 'string')
      .map((x) => x.trim())
      .filter((x) => x.length > 0);
  }
  if (typeof raw === 'string' && raw.trim()) {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

export function parseDependsOnIds(args: Record<string, unknown>): string[] {
  return coerceStringList(args['depends_on'] ?? args['dependsOn']);
}

export function batchIndicesByDependencies(
  items: ReadonlyArray<{ id: string; dependsOn: readonly string[] }>
): number[][] {
  if (items.length === 0) return [];
  const idToIndex = new Map<string, number>();
  for (let i = 0; i < items.length; i++) {
    const id = items[i]!.id;
    if (!idToIndex.has(id)) idToIndex.set(id, i);
  }

  const remaining = new Set(items.map((_, i) => i));
  const satisfied = new Set<string>();
  const batches: number[][] = [];

  while (remaining.size > 0) {
    const batch: number[] = [];
    for (const i of remaining) {
      const deps = items[i]!.dependsOn;
      const ready = deps.every((d) => satisfied.has(d) || !idToIndex.has(d));
      if (ready) batch.push(i);
    }
    if (batch.length === 0) {
      log.warn('dependency cycle or unsatisfied deps; flushing remaining in one batch', {
        remaining: remaining.size
      });
      batches.push([...remaining].sort((a, b) => a - b));
      break;
    }
    batch.sort((a, b) => a - b);
    for (const i of batch) remaining.delete(i);
    for (const i of batch) satisfied.add(items[i]!.id);
    batches.push(batch);
  }
  return batches;
}
