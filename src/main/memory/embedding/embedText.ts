/**
 * Embedding facade — local feature hashing by default; optional Ollama via
 * settings or `VYOTIQ_VECTOR_EMBED=ollama`.
 */

import { getVectorEmbedder } from '../../settings/vectorEmbedRuntime.js';
import { embedLocal, embedLocalBatch } from './localEmbedder.js';
import { embedOllamaOrLocal, embedOllamaOrLocalBatch } from './ollamaEmbedder.js';

function useOllama(): boolean {
  return getVectorEmbedder() === 'ollama';
}

export async function embedQuery(text: string): Promise<Float32Array> {
  if (useOllama()) return embedOllamaOrLocal(text);
  return embedLocal(text);
}

export async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  if (useOllama()) return embedOllamaOrLocalBatch(texts);
  return embedLocalBatch(texts);
}
