/**
 * Deterministic local embeddings via signed feature hashing. No network,
 * no model weights — suitable for offline hybrid retrieval.
 */

import { createHash } from 'node:crypto';
import { VECTOR_EMBED_DIM } from '@shared/memory/vectorConstants.js';
import { tokenizeForMemory } from '@shared/memory/textTokens.js';

function hashToken(token: string): number {
  const hex = createHash('sha256').update(token).digest('hex').slice(0, 8);
  return Number.parseInt(hex, 16);
}

function normalize(vec: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < vec.length; i++) {
    norm += vec[i]! * vec[i]!;
  }
  norm = Math.sqrt(norm);
  if (norm <= 0) return vec;
  for (let i = 0; i < vec.length; i++) {
    vec[i]! /= norm;
  }
  return vec;
}

/** Embed a single text block into a unit L2-normalized vector. */
export function embedLocal(text: string, dim = VECTOR_EMBED_DIM): Float32Array {
  const vec = new Float32Array(dim);
  const tokens = tokenizeForMemory(text);
  if (tokens.length === 0) return vec;
  for (const token of tokens) {
    const h = hashToken(token);
    const idx = h % dim;
    const sign = (h >> 8) & 1 ? 1 : -1;
    vec[idx]! += sign;
  }
  return normalize(vec);
}

export function embedLocalBatch(texts: string[], dim = VECTOR_EMBED_DIM): Float32Array[] {
  return texts.map((t) => embedLocal(t, dim));
}
