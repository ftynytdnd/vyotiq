/**
 * Incremental background indexer — workspace notes + source files.
 */

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { relative } from 'node:path';
import fg from 'fast-glob';
import { MEMORY_SUBDIR, WORKSPACE_DOTDIR } from '@shared/constants.js';
import { VECTOR_MAX_FILE_BYTES } from '@shared/memory/vectorConstants.js';
import { listWorkspaceNotes } from '../workspaceNotes.js';
import { isRunProgressKey } from '../runProgressNote.js';
import { embedBatch } from '../embedding/embedText.js';
import { chunkText } from './chunkText.js';
import { INDEXABLE_GLOB, INDEXABLE_IGNORE } from './indexableFiles.js';
import {
  acquireVectorDb,
  deleteSourceChunks,
  getSourceHash,
  insertChunks,
  pruneMissingSources,
  releaseVectorDb
} from './vectorDb.js';
import { logger } from '../../logging/logger.js';

const log = logger.child('vector-index');

export interface VectorIndexStats {
  notesIndexed: number;
  filesIndexed: number;
  chunksWritten: number;
  skipped: number;
  pruned: number;
  durationMs: number;
}

function contentHash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function noteRelPath(key: string): string {
  return `${WORKSPACE_DOTDIR}/${MEMORY_SUBDIR}/${key}.md`;
}

async function indexNote(
  db: Awaited<ReturnType<typeof acquireVectorDb>>,
  key: string,
  content: string,
  mtime: number,
  signal?: AbortSignal
): Promise<{ chunks: number; skipped: boolean }> {
  if (signal?.aborted) return { chunks: 0, skipped: true };
  const relPath = noteRelPath(key);
  const hash = contentHash(content);
  const prior = getSourceHash(db, 'note', relPath);
  if (prior === hash) return { chunks: 0, skipped: true };

  deleteSourceChunks(db, 'note', relPath);
  const pieces = chunkText(content);
  if (pieces.length === 0) return { chunks: 0, skipped: false };

  const embeddings = await embedBatch(pieces);
  if (signal?.aborted) return { chunks: 0, skipped: true };

  insertChunks(
    db,
    pieces.map((piece, chunkIndex) => ({
      sourceKind: 'note' as const,
      sourceKey: key,
      relPath,
      chunkIndex,
      content: piece,
      contentHash: hash,
      mtime,
      embedding: embeddings[chunkIndex]!
    }))
  );
  return { chunks: pieces.length, skipped: false };
}

async function indexCodeFile(
  db: Awaited<ReturnType<typeof acquireVectorDb>>,
  workspacePath: string,
  absPath: string,
  signal?: AbortSignal
): Promise<{ chunks: number; skipped: boolean }> {
  if (signal?.aborted) return { chunks: 0, skipped: true };
  const relPath = relative(workspacePath, absPath).replace(/\\/g, '/');
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(absPath);
  } catch {
    return { chunks: 0, skipped: true };
  }
  if (!stat.isFile() || stat.size > VECTOR_MAX_FILE_BYTES) {
    return { chunks: 0, skipped: true };
  }

  let content: string;
  try {
    content = await fs.readFile(absPath, 'utf8');
  } catch {
    return { chunks: 0, skipped: true };
  }
  const hash = contentHash(content);
  const prior = getSourceHash(db, 'code', relPath);
  if (prior === hash) return { chunks: 0, skipped: true };

  deleteSourceChunks(db, 'code', relPath);
  const pieces = chunkText(content);
  if (pieces.length === 0) return { chunks: 0, skipped: false };

  const embeddings = await embedBatch(pieces);
  if (signal?.aborted) return { chunks: 0, skipped: true };

  insertChunks(
    db,
    pieces.map((piece, chunkIndex) => ({
      sourceKind: 'code' as const,
      sourceKey: relPath,
      relPath,
      chunkIndex,
      content: piece,
      contentHash: hash,
      mtime: stat.mtimeMs,
      embedding: embeddings[chunkIndex]!
    }))
  );
  return { chunks: pieces.length, skipped: false };
}

export async function indexWorkspaceVectors(
  workspacePath: string,
  signal?: AbortSignal
): Promise<VectorIndexStats> {
  const started = Date.now();
  const stats: VectorIndexStats = {
    notesIndexed: 0,
    filesIndexed: 0,
    chunksWritten: 0,
    skipped: 0,
    pruned: 0,
    durationMs: 0
  };

  let db: Awaited<ReturnType<typeof acquireVectorDb>>;
  try {
    db = await acquireVectorDb(workspacePath);
  } catch (err: unknown) {
    log.warn('failed to open vector db', { workspacePath, err });
    stats.durationMs = Date.now() - started;
    return stats;
  }

  try {
    const notePaths = new Set<string>();
    try {
      const notes = await listWorkspaceNotes(workspacePath);
      for (const note of notes) {
        if (signal?.aborted) break;
        if (isRunProgressKey(note.key)) continue;
        notePaths.add(noteRelPath(note.key));
        const result = await indexNote(db, note.key, note.content, note.updatedAt, signal);
        if (result.skipped) stats.skipped += 1;
        else stats.notesIndexed += 1;
        stats.chunksWritten += result.chunks;
      }
    } catch (err: unknown) {
      log.warn('note indexing failed', { workspacePath, err });
    }

    const codePaths = new Set<string>();
    try {
      const files = await fg(INDEXABLE_GLOB, {
        cwd: workspacePath,
        ignore: INDEXABLE_IGNORE,
        absolute: true,
        onlyFiles: true,
        suppressErrors: true
      });
      for (const absPath of files) {
        if (signal?.aborted) break;
        const relPath = relative(workspacePath, absPath).replace(/\\/g, '/');
        codePaths.add(relPath);
        const result = await indexCodeFile(db, workspacePath, absPath, signal);
        if (result.skipped) stats.skipped += 1;
        else stats.filesIndexed += 1;
        stats.chunksWritten += result.chunks;
      }
    } catch (err: unknown) {
      log.warn('code indexing failed', { workspacePath, err });
    }

    if (!signal?.aborted) {
      stats.pruned += pruneMissingSources(db, 'note', notePaths);
      stats.pruned += pruneMissingSources(db, 'code', codePaths);
    }

    stats.durationMs = Date.now() - started;
    log.info('vector index pass complete', {
      workspacePath,
      ...stats,
      ...(stats.skipped > 0 && stats.chunksWritten === 0
        ? { note: 'skipped entries unchanged since prior hash' }
        : {})
    });
    return stats;
  } finally {
    releaseVectorDb(workspacePath);
  }
}
