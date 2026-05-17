/**
 * Per-file change index. One JSON file per workspace-relative path
 * under `files/<base64url(relpath)>.json` — append-only history rows
 * that mirror the same change recorded in the run manifest.
 *
 * The index lets the renderer's `FileHistoryList` paint a file's
 * timeline without scanning every run manifest. The run manifest is
 * still the authority for the entry's content payload (hashes, hunks);
 * this index just keeps the indirection cheap.
 */

import { promises as fs } from 'node:fs';
import type { FileHistoryRow } from '@shared/types/checkpoint.js';
import { fileIndexPath, filesDir } from './paths.js';
import { decodeFileKey } from './paths.js';
import { logger } from '../logging/logger.js';
import { atomicWriteJson } from './atomicWrite.js';

const log = logger.child('checkpoints/fileIndex');

// relPath-keyed write chain so concurrent appends never tear.
const writeChains = new Map<string, Promise<void>>();

function key(workspaceId: string, relPath: string): string {
  return `${workspaceId}\u0000${relPath}`;
}

function serialize(k: string, fn: () => Promise<void>): Promise<void> {
  const prev = writeChains.get(k) ?? Promise.resolve();
  const next = prev.then(fn).catch((err) => log.error('fileIndex write failed', { key: k, err }));
  writeChains.set(k, next);
  return next;
}

async function loadRaw(
  workspaceId: string,
  relPath: string
): Promise<FileHistoryRow[]> {
  const path = fileIndexPath(workspaceId, relPath);
  try {
    const raw = await fs.readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as FileHistoryRow[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return [];
    log.warn('fileIndex unreadable; treating as empty', { workspaceId, relPath, err });
    return [];
  }
}

async function save(
  workspaceId: string,
  relPath: string,
  rows: FileHistoryRow[]
): Promise<void> {
  await atomicWriteJson(fileIndexPath(workspaceId, relPath), rows);
}

/** Append one row to a file's history. */
export async function appendRow(
  workspaceId: string,
  relPath: string,
  row: FileHistoryRow
): Promise<void> {
  const k = key(workspaceId, relPath);
  return serialize(k, async () => {
    const rows = await loadRaw(workspaceId, relPath);
    rows.push(row);
    await save(workspaceId, relPath, rows);
  });
}

/**
 * Flip the `reverted` flag on the row that matches `entryId`. Idempotent.
 */
export async function markRowReverted(
  workspaceId: string,
  relPath: string,
  entryId: string
): Promise<void> {
  const k = key(workspaceId, relPath);
  return serialize(k, async () => {
    const rows = await loadRaw(workspaceId, relPath);
    const target = rows.find((r) => r.entryId === entryId);
    if (!target || target.reverted) return;
    target.reverted = true;
    await save(workspaceId, relPath, rows);
  });
}

/** Read a file's full chronological history. */
export async function readHistory(
  workspaceId: string,
  relPath: string
): Promise<FileHistoryRow[]> {
  // Drain any in-flight append chain so the read is self-consistent.
  await writeChains.get(key(workspaceId, relPath));
  return loadRaw(workspaceId, relPath);
}

/**
 * Compact summary of every file that has any history under one
 * workspace. Used by the Checkpoints view's file tab.
 */
export async function listFilesWithHistory(
  workspaceId: string
): Promise<Array<{ filePath: string; changeCount: number; lastChangeAt: number }>> {
  const dir = filesDir(workspaceId);
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return [];
    throw err;
  }
  const out: Awaited<ReturnType<typeof listFilesWithHistory>> = [];
  for (const name of names) {
    if (!name.endsWith('.json') || name.endsWith('.tmp.json')) continue;
    const key = name.slice(0, -'.json'.length);
    let relPath: string;
    try {
      relPath = decodeFileKey(key);
    } catch {
      continue;
    }
    const rows = await loadRaw(workspaceId, relPath);
    if (rows.length === 0) continue;
    const last = rows[rows.length - 1]!;
    out.push({
      filePath: relPath,
      changeCount: rows.length,
      lastChangeAt: last.ts
    });
  }
  out.sort((a, b) => b.lastChangeAt - a.lastChangeAt);
  return out;
}

/** Drop the entire index for one file. Used by GC. */
export async function deleteFileIndex(workspaceId: string, relPath: string): Promise<void> {
  const k = key(workspaceId, relPath);
  return serialize(k, async () => {
    try {
      await fs.unlink(fileIndexPath(workspaceId, relPath));
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        log.warn('deleteFileIndex failed', { workspaceId, relPath, err });
      }
    }
  });
}

/** Drain every in-flight write chain. Called from app `before-quit`. */
export async function flushAll(): Promise<void> {
  await Promise.all(Array.from(writeChains.values()));
}
