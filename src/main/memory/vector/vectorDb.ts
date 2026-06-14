/**
 * Per-workspace sqlite-vec database for chunked embeddings.
 */

import { mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import * as sqliteVec from '@photostructure/sqlite-vec';
import {
  VECTOR_EMBED_DIM,
  VECTOR_INDEX_DB,
  VECTOR_INDEX_SUBDIR
} from '@shared/memory/vectorConstants.js';
import { WORKSPACE_DOTDIR } from '@shared/constants.js';

export type VectorSourceKind = 'note' | 'code';

const SCHEMA_VERSION = 1;

function indexDir(workspacePath: string): string {
  return join(workspacePath, WORKSPACE_DOTDIR, VECTOR_INDEX_SUBDIR);
}

export function indexDbPath(workspacePath: string): string {
  return join(indexDir(workspacePath), VECTOR_INDEX_DB);
}

function ensureSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS source_state (
      source_kind TEXT NOT NULL,
      rel_path TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      mtime INTEGER NOT NULL,
      PRIMARY KEY (source_kind, rel_path)
    );
    CREATE TABLE IF NOT EXISTS chunk_index (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_kind TEXT NOT NULL,
      source_key TEXT NOT NULL,
      rel_path TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      mtime INTEGER NOT NULL,
      embedding BLOB NOT NULL CHECK(vec_length(embedding) = ${VECTOR_EMBED_DIM})
    );
    CREATE INDEX IF NOT EXISTS idx_chunk_source ON chunk_index(source_kind, rel_path);
  `);
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get('schema_version') as
    | { value: string }
    | undefined;
  if (!row) {
    db.prepare('INSERT INTO meta(key, value) VALUES (?, ?)').run(
      'schema_version',
      String(SCHEMA_VERSION)
    );
  }
}

interface VectorDbEntry {
  db: DatabaseSync;
  /** Active index/search callers — never close while refs > 0. */
  refs: number;
}

const openDbs = new Map<string, VectorDbEntry>();
const OPEN_DB_MAX = 3;

function touchLru(workspacePath: string, entry: VectorDbEntry): void {
  openDbs.delete(workspacePath);
  openDbs.set(workspacePath, entry);
}

function closeEntry(path: string, entry: VectorDbEntry): void {
  openDbs.delete(path);
  try {
    entry.db.close();
  } catch {
    // ignore
  }
}

/** Evict idle (refs === 0) handles when the cache grows past the soft cap. */
function evictIdleIfNeeded(): void {
  while (openDbs.size > OPEN_DB_MAX) {
    let evicted = false;
    for (const [path, entry] of openDbs) {
      if (entry.refs > 0) continue;
      closeEntry(path, entry);
      evicted = true;
      break;
    }
    if (!evicted) break;
  }
}

export async function openVectorDb(workspacePath: string): Promise<DatabaseSync> {
  return acquireVectorDb(workspacePath);
}

/** Borrow an open vector db handle; pair with {@link releaseVectorDb}. */
export async function acquireVectorDb(workspacePath: string): Promise<DatabaseSync> {
  const existing = openDbs.get(workspacePath);
  if (existing) {
    existing.refs += 1;
    touchLru(workspacePath, existing);
    return existing.db;
  }
  await mkdir(indexDir(workspacePath), { recursive: true });
  const db = new DatabaseSync(indexDbPath(workspacePath), { allowExtension: true });
  sqliteVec.load(db);
  ensureSchema(db);
  const entry: VectorDbEntry = { db, refs: 1 };
  evictIdleIfNeeded();
  openDbs.set(workspacePath, entry);
  return db;
}

export function releaseVectorDb(workspacePath: string): void {
  const entry = openDbs.get(workspacePath);
  if (!entry) return;
  entry.refs = Math.max(0, entry.refs - 1);
  if (entry.refs === 0) {
    evictIdleIfNeeded();
  }
}

export function closeVectorDb(workspacePath: string): void {
  const entry = openDbs.get(workspacePath);
  if (!entry) return;
  entry.refs = 0;
  closeEntry(workspacePath, entry);
}

export function closeAllVectorDbs(): void {
  for (const [path, entry] of [...openDbs.entries()]) {
    entry.refs = 0;
    closeEntry(path, entry);
  }
}

export function getSourceHash(
  db: DatabaseSync,
  sourceKind: VectorSourceKind,
  relPath: string
): string | null {
  const row = db
    .prepare('SELECT content_hash FROM source_state WHERE source_kind = ? AND rel_path = ?')
    .get(sourceKind, relPath) as { content_hash: string } | undefined;
  return row?.content_hash ?? null;
}

export function deleteSourceChunks(
  db: DatabaseSync,
  sourceKind: VectorSourceKind,
  relPath: string
): void {
  db.prepare('DELETE FROM chunk_index WHERE source_kind = ? AND rel_path = ?').run(
    sourceKind,
    relPath
  );
  db.prepare('DELETE FROM source_state WHERE source_kind = ? AND rel_path = ?').run(
    sourceKind,
    relPath
  );
}

export function insertChunks(
  db: DatabaseSync,
  rows: Array<{
    sourceKind: VectorSourceKind;
    sourceKey: string;
    relPath: string;
    chunkIndex: number;
    content: string;
    contentHash: string;
    mtime: number;
    embedding: Float32Array;
  }>
): void {
  const ins = db.prepare(`
    INSERT INTO chunk_index(
      source_kind, source_key, rel_path, chunk_index, content, content_hash, mtime, embedding
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const upsertState = db.prepare(`
    INSERT INTO source_state(source_kind, rel_path, content_hash, mtime)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(source_kind, rel_path) DO UPDATE SET
      content_hash = excluded.content_hash,
      mtime = excluded.mtime
  `);
  db.exec('BEGIN');
  try {
    for (const row of rows) {
      ins.run(
        row.sourceKind,
        row.sourceKey,
        row.relPath,
        row.chunkIndex,
        row.content,
        row.contentHash,
        row.mtime,
        new Uint8Array(row.embedding.buffer)
      );
    }
    if (rows.length > 0) {
      const head = rows[0]!;
      upsertState.run(head.sourceKind, head.relPath, head.contentHash, head.mtime);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function listIndexedPaths(db: DatabaseSync, sourceKind: VectorSourceKind): string[] {
  const rows = db
    .prepare('SELECT rel_path FROM source_state WHERE source_kind = ?')
    .all(sourceKind) as Array<{ rel_path: string }>;
  return rows.map((r) => r.rel_path);
}

export function pruneMissingSources(
  db: DatabaseSync,
  sourceKind: VectorSourceKind,
  keepPaths: Set<string>
): number {
  const existing = listIndexedPaths(db, sourceKind);
  let removed = 0;
  for (const relPath of existing) {
    if (!keepPaths.has(relPath)) {
      deleteSourceChunks(db, sourceKind, relPath);
      removed += 1;
    }
  }
  return removed;
}

export function chunkCount(db: DatabaseSync): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM chunk_index').get() as { n: number };
  return row.n ?? 0;
}

/** Drop on-disk index and close any open handle (e.g. embedder change). */
export async function resetVectorIndex(workspacePath: string): Promise<void> {
  closeVectorDb(workspacePath);
  try {
    await unlink(indexDbPath(workspacePath));
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
  }
}

// Re-export dim for callers that import from vectorDb
export { VECTOR_EMBED_DIM };
