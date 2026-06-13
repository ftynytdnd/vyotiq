/**
 * Vector similarity search over the workspace chunk index.
 */

import type { DatabaseSync } from 'node:sqlite';
import { VECTOR_SEARCH_TOP_K } from '@shared/memory/vectorConstants.js';
import { embedQuery } from '../embedding/embedText.js';
import type { VectorSourceKind } from './vectorDb.js';
import { chunkCount, openVectorDb } from './vectorDb.js';

export interface VectorSearchHit {
  sourceKind: VectorSourceKind;
  sourceKey: string;
  relPath: string;
  chunkIndex: number;
  content: string;
  /** Cosine distance — lower is more similar. */
  distance: number;
  /** 0–1 similarity derived from distance. */
  similarity: number;
}

function distanceToSimilarity(distance: number): number {
  const sim = 1 - distance;
  return sim < 0 ? 0 : sim > 1 ? 1 : sim;
}

export async function searchVectorIndex(
  workspacePath: string,
  query: string,
  topK = VECTOR_SEARCH_TOP_K
): Promise<VectorSearchHit[]> {
  if (!query.trim()) return [];
  let db: DatabaseSync;
  try {
    db = await openVectorDb(workspacePath);
  } catch {
    return [];
  }
  if (chunkCount(db) === 0) return [];

  const embedding = await embedQuery(query);
  const rows = db
    .prepare(
      `SELECT source_kind, source_key, rel_path, chunk_index, content,
              vec_distance_cosine(embedding, ?) AS distance
       FROM chunk_index
       ORDER BY distance
       LIMIT ?`
    )
    .all(new Uint8Array(embedding.buffer), topK) as Array<{
    source_kind: VectorSourceKind;
    source_key: string;
    rel_path: string;
    chunk_index: number;
    content: string;
    distance: number;
  }>;

  return rows.map((r) => ({
    sourceKind: r.source_kind,
    sourceKey: r.source_key,
    relPath: r.rel_path,
    chunkIndex: r.chunk_index,
    content: r.content,
    distance: r.distance,
    similarity: distanceToSimilarity(r.distance)
  }));
}
