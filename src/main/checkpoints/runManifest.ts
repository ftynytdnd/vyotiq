/**
 * Per-run manifest. One JSON file under `runs/<runId>.json` that
 * collects every checkpoint entry the run produced.
 *
 * Writes are serialized through a per-run promise chain so concurrent
 * tool calls inside the same run never tear the JSON. The chain is
 * cleared on `finalizeRun` so a long-lived process can't leak entries
 * across runs.
 */

import { promises as fs, existsSync } from 'node:fs';
import type {
  CheckpointEntry,
  CheckpointRunManifest
} from '@shared/types/checkpoint.js';
import { runManifestPath, runsDir } from './paths.js';
import { logger } from '../logging/logger.js';
import { atomicWriteJson } from './atomicWrite.js';

const log = logger.child('checkpoints/runManifest');

// runId → tail of the serialized write chain.
const writeChains = new Map<string, Promise<void>>();
// runId → in-memory cache of the manifest. Persisted via the chain.
const cache = new Map<string, CheckpointRunManifest>();

function serialize(runId: string, fn: () => Promise<void>): Promise<void> {
  const prev = writeChains.get(runId) ?? Promise.resolve();
  const next = prev.then(fn).catch((err) => {
    log.error('run manifest write failed', { runId, err });
  });
  writeChains.set(runId, next);
  return next;
}

async function persist(manifest: CheckpointRunManifest): Promise<void> {
  await atomicWriteJson(
    runManifestPath(manifest.workspaceId, manifest.runId),
    manifest
  );
}

/**
 * Open a new run manifest. Idempotent — re-opening an existing run is
 * a no-op (the orchestrator's run-id is stable per run, so this matters
 * only for crash recovery / repeated `startRun` calls in tests).
 */
export async function openRun(opts: {
  runId: string;
  conversationId: string;
  workspaceId: string;
  label: string;
  startedAt: number;
}): Promise<CheckpointRunManifest> {
  const cached = cache.get(opts.runId);
  if (cached) return cached;
  const path = runManifestPath(opts.workspaceId, opts.runId);
  let manifest: CheckpointRunManifest;
  if (existsSync(path)) {
    try {
      const raw = await fs.readFile(path, 'utf8');
      manifest = JSON.parse(raw) as CheckpointRunManifest;
    } catch (err) {
      // Corrupted manifest — start fresh and overwrite, but keep a
      // diagnostic line so we can grep for the pattern if it recurs.
      log.warn('existing run manifest unreadable; starting fresh', { runId: opts.runId, err });
      manifest = freshManifest(opts);
      await persist(manifest);
    }
  } else {
    manifest = freshManifest(opts);
    await persist(manifest);
  }
  cache.set(opts.runId, manifest);
  return manifest;
}

function freshManifest(opts: {
  runId: string;
  conversationId: string;
  workspaceId: string;
  label: string;
  startedAt: number;
}): CheckpointRunManifest {
  return {
    runId: opts.runId,
    conversationId: opts.conversationId,
    workspaceId: opts.workspaceId,
    label: opts.label,
    startedAt: opts.startedAt,
    endedAt: null,
    entries: []
  };
}

/** Append an entry to an open run manifest and flush to disk. */
export async function appendEntry(entry: CheckpointEntry): Promise<void> {
  const manifest = cache.get(entry.runId);
  if (!manifest) {
    log.warn('appendEntry to unknown run; auto-opening', { runId: entry.runId });
    const recovered = await openRun({
      runId: entry.runId,
      conversationId: entry.conversationId,
      workspaceId: entry.workspaceId,
      label: 'Recovered run',
      startedAt: entry.ts
    });
    recovered.entries.push(entry);
    return serialize(entry.runId, () => persist(recovered));
  }
  manifest.entries.push(entry);
  return serialize(entry.runId, () => persist(manifest));
}

/**
 * Mark an entry as reverted in its run manifest. Idempotent: a second
 * call against the same entry is a no-op. Returns the patched entry
 * for callers that want to broadcast it.
 */
export async function markEntryReverted(
  workspaceId: string,
  runId: string,
  entryId: string
): Promise<CheckpointEntry | null> {
  const manifest = await readRun(workspaceId, runId);
  if (!manifest) return null;
  const entry = manifest.entries.find((e) => e.id === entryId);
  if (!entry) return null;
  if (entry.reverted === true) return entry;
  entry.reverted = true;
  cache.set(runId, manifest);
  await serialize(runId, () => persist(manifest));
  return entry;
}

/**
 * Finalize a run — stamp `endedAt` and drop the in-memory cache so the
 * next read of the manifest comes from disk. The write chain is
 * awaited before resolving so callers can rely on a finalized manifest
 * actually being on disk after `await finalizeRun(...)`.
 */
export async function finalizeRun(runId: string): Promise<void> {
  const manifest = cache.get(runId);
  if (!manifest) return;
  if (manifest.endedAt === null) {
    manifest.endedAt = Date.now();
  }
  await serialize(runId, () => persist(manifest));
  // Wait for any preceding chain entries to finish too. Then drop
  // the cache so the runtime footprint stays bounded.
  await writeChains.get(runId);
  cache.delete(runId);
  writeChains.delete(runId);
}

/** Drain every in-flight write chain. Called from app `before-quit`. */
export async function flushAll(): Promise<void> {
  await Promise.all(Array.from(writeChains.values()));
}

/** Read a run manifest off disk (or from cache). Returns null when absent. */
export async function readRun(
  workspaceId: string,
  runId: string
): Promise<CheckpointRunManifest | null> {
  const cached = cache.get(runId);
  if (cached) return cached;
  const path = runManifestPath(workspaceId, runId);
  try {
    const raw = await fs.readFile(path, 'utf8');
    return JSON.parse(raw) as CheckpointRunManifest;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    log.error('readRun failed', { workspaceId, runId, err });
    return null;
  }
}

/** List every run id stored under one workspace. Newest-first by startedAt. */
export async function listRunHeads(workspaceId: string): Promise<
  Array<{
    runId: string;
    conversationId: string;
    label: string;
    startedAt: number;
    endedAt: number | null;
    entryCount: number;
  }>
> {
  const dir = runsDir(workspaceId);
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return [];
    throw err;
  }
  const out: Awaited<ReturnType<typeof listRunHeads>> = [];
  for (const name of names) {
    if (!name.endsWith('.json') || name.endsWith('.tmp.json')) continue;
    const runId = name.slice(0, -'.json'.length);
    const manifest = await readRun(workspaceId, runId);
    if (!manifest) continue;
    out.push({
      runId: manifest.runId,
      conversationId: manifest.conversationId,
      label: manifest.label,
      startedAt: manifest.startedAt,
      endedAt: manifest.endedAt,
      entryCount: manifest.entries.length
    });
  }
  out.sort((a, b) => b.startedAt - a.startedAt);
  return out;
}

/** Delete a run manifest. Used by GC / prune. */
export async function deleteRun(workspaceId: string, runId: string): Promise<void> {
  cache.delete(runId);
  writeChains.delete(runId);
  try {
    await fs.unlink(runManifestPath(workspaceId, runId));
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      log.warn('deleteRun failed', { workspaceId, runId, err });
    }
  }
}
