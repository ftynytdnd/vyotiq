/** Local vector index defaults — shared by main-process indexer and tests. */

export const VECTOR_INDEX_SUBDIR = 'vector';
export const VECTOR_INDEX_DB = 'index.db';
export const VECTOR_EMBED_DIM = 256;
export const VECTOR_CHUNK_CHARS = 800;
export const VECTOR_CHUNK_OVERLAP = 120;
/** Skip indexing individual files larger than this (bytes). */
export const VECTOR_MAX_FILE_BYTES = 512 * 1024;
export const VECTOR_MAX_CHUNKS_PER_FILE = 24;
export const VECTOR_SEARCH_TOP_K = 12;
