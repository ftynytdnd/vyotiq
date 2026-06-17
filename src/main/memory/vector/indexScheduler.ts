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
const inFlight = new Map<string, Promise<VectorIndexStats | null>>();
const forceReindexInFlight = new Map<string, Promise<VectorIndexStats | null>>();

async function awaitInFlight(workspacePath: string): Promise<void> {
  const prior = inFlight.get(workspacePath);
  if (!prior) return;
  await prior.catch(() => null);
}

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
  running.get(workspacePath)?.abort();
  await awaitInFlight(workspacePath);

  const ac = new AbortController();
  running.set(workspacePath, ac);

  const task = (async (): Promise<VectorIndexStats | null> => {
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
  })();

  inFlight.set(workspacePath, task);
  try {
    return await task;
  } finally {
    if (inFlight.get(workspacePath) === task) {
      inFlight.delete(workspacePath);
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

export async function disposeWorkspaceVectorIndex(workspacePath: string): Promise<void> {
  cancelWorkspaceVectorIndex(workspacePath);
  await awaitInFlight(workspacePath);
  closeVectorDb(workspacePath);
}

export async function disposeAllVectorIndexesAsync(): Promise<void> {
  for (const timer of debounceTimers.values()) clearTimeout(timer);
  debounceTimers.clear();
  for (const ac of running.values()) ac.abort();
  running.clear();
  await Promise.allSettled([...inFlight.values()]);
}

/** Clear stored vectors and rebuild immediately (no debounce). Coalesces duplicate requests. */
export function forceReindexWorkspace(
  workspacePath: string
): Promise<VectorIndexStats | null> {
  const existing = forceReindexInFlight.get(workspacePath);
  if (existing) {
    log.debug('force reindex coalesced', { workspacePath });
    return existing;
  }

  const task = (async (): Promise<VectorIndexStats | null> => {
    log.info('force reindex start', { workspacePath });
    cancelWorkspaceVectorIndex(workspacePath);
    await awaitInFlight(workspacePath);
    await resetVectorIndex(workspacePath);
    return runWorkspaceVectorIndex(workspacePath);
  })();

  forceReindexInFlight.set(workspacePath, task);
  void task.finally(() => {
    if (forceReindexInFlight.get(workspacePath) === task) {
      forceReindexInFlight.delete(workspacePath);
    }
  });
  return task;
}
