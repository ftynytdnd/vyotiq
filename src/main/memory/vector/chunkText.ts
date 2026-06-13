import {
  VECTOR_CHUNK_CHARS,
  VECTOR_CHUNK_OVERLAP,
  VECTOR_MAX_CHUNKS_PER_FILE
} from '@shared/memory/vectorConstants.js';

/**
 * Split long text into overlapping chunks for vector indexing.
 */
export function chunkText(
  text: string,
  chunkSize = VECTOR_CHUNK_CHARS,
  overlap = VECTOR_CHUNK_OVERLAP
): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];
  if (normalized.length <= chunkSize) return [normalized];

  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length && chunks.length < VECTOR_MAX_CHUNKS_PER_FILE) {
    let end = Math.min(start + chunkSize, normalized.length);
    if (end < normalized.length) {
      const slice = normalized.slice(start, end);
      const breakAt = Math.max(
        slice.lastIndexOf('\n\n'),
        slice.lastIndexOf('\n'),
        slice.lastIndexOf(' ')
      );
      if (breakAt > chunkSize * 0.4) {
        end = start + breakAt;
      }
    }
    const piece = normalized.slice(start, end).trim();
    if (piece.length > 0) chunks.push(piece);
    if (end >= normalized.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}
