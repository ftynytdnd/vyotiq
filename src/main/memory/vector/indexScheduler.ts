/**
 * Debounced background vector indexing — one in-flight job per workspace path.
 */

import { indexWorkspaceVectors, type VectorIndexStats } from './indexWorkspace.js';
import { closeVectorDb, resetVectorIndex } from './vectorDb.js';
import { logger } from '../../logging/logger.js';

const log = logger.child('vector-scheduler');

const DEBOUNCE_MS = 8_000;
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const running = new Map<string, AbortController>();

export function scheduleWorkspaceVectorIndex(workspacePath: string): void {
  if (!workspacePath) return;
  const prior = debounceTimers.get(workspacePath);
  if (prior) clearTimeout(prior);
  const timer = setTimeout(() => {
    debounceTimers.delete(workspacePath);
    void runWorkspaceVectorIndex(workspacePath);
  }, DEBOUNCE_MS);
  debounceTimers.set(workspacePath, timer);
}

export async function runWorkspaceVectorIndex(
  workspacePath: string
): Promise<VectorIndexStats | null> {
  const prior = running.get(workspacePath);
  prior?.abort();
  const ac = new AbortController();
  running.set(workspacePath, ac);
  try {
    return await indexWorkspaceVectors(workspacePath, ac.signal);
  } catch (err: unknown) {
    if (ac.signal.aborted) return null;
    log.warn('vector index run failed', { workspacePath, err });
    return null;
  } finally {
    if (running.get(workspacePath) === ac) {
      running.delete(workspacePath);
    }
  }
}

export function cancelWorkspaceVectorIndex(workspacePath: string): void {
  const timer = debounceTimers.get(workspacePath);
  if (timer) {
    clearTimeout(timer);
    debounceTimers.delete(workspacePath);
  }
  running.get(workspacePath)?.abort();
  running.delete(workspacePath);
}

export function disposeWorkspaceVectorIndex(workspacePath: string): void {
  cancelWorkspaceVectorIndex(workspacePath);
  closeVectorDb(workspacePath);
}

export function disposeAllVectorIndexes(): void {
  for (const timer of debounceTimers.values()) clearTimeout(timer);
  debounceTimers.clear();
  for (const ac of running.values()) ac.abort();
  running.clear();
}

/** Clear stored vectors and rebuild immediately (no debounce). */
export async function forceReindexWorkspace(
  workspacePath: string
): Promise<VectorIndexStats | null> {
  cancelWorkspaceVectorIndex(workspacePath);
  await resetVectorIndex(workspacePath);
  return runWorkspaceVectorIndex(workspacePath);
}
