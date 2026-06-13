/**
 * Optional Ollama `/api/embeddings` backend. Activated when
 * `VYOTIQ_VECTOR_EMBED=ollama` and an `ollama-native` provider exists.
 */

import { VECTOR_EMBED_DIM } from '@shared/memory/vectorConstants.js';
import { listProviders, getProviderWithKey } from '../../providers/providerStore.js';
import { embedLocal, embedLocalBatch } from './localEmbedder.js';

function projectToDim(vec: Float32Array, dim = VECTOR_EMBED_DIM): Float32Array {
  const out = new Float32Array(dim);
  const len = Math.min(dim, vec.length);
  for (let i = 0; i < len; i++) {
    out[i] = vec[i] ?? 0;
  }
  let norm = 0;
  for (let i = 0; i < out.length; i++) {
    norm += out[i]! * out[i]!;
  }
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < out.length; i++) {
      out[i]! /= norm;
    }
  }
  return out;
}

const DEFAULT_MODEL = 'nomic-embed-text';

async function resolveOllama(): Promise<{ baseUrl: string; apiKey: string; model: string } | null> {
  const providers = await listProviders();
  const candidate = providers.find((p) => p.dialect === 'ollama-native' && p.enabled !== false);
  if (!candidate) return null;
  const withKey = await getProviderWithKey(candidate.id);
  if (!withKey) return null;
  const baseUrl = withKey.baseUrl.replace(/\/+$/, '');
  const model =
    process.env.VYOTIQ_VECTOR_EMBED_MODEL?.trim() ||
    candidate.models?.find((m) => /embed/i.test(m.id))?.id ||
    DEFAULT_MODEL;
  return { baseUrl, apiKey: withKey.apiKey, model };
}

async function fetchEmbedding(text: string, baseUrl: string, apiKey: string, model: string): Promise<Float32Array> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const res = await fetch(`${baseUrl}/api/embeddings`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model, prompt: text })
  });
  if (!res.ok) {
    throw new Error(`Ollama embeddings HTTP ${res.status}`);
  }
  const json = (await res.json()) as { embedding?: number[] };
  if (!Array.isArray(json.embedding) || json.embedding.length === 0) {
    throw new Error('Ollama embeddings response missing embedding array');
  }
  const vec = new Float32Array(json.embedding.length);
  for (let i = 0; i < json.embedding.length; i++) {
    vec[i] = json.embedding[i] ?? 0;
  }
  return projectToDim(vec);
}

export async function embedOllamaOrLocal(text: string): Promise<Float32Array> {
  const cfg = await resolveOllama();
  if (!cfg) return embedLocal(text);
  try {
    return await fetchEmbedding(text, cfg.baseUrl, cfg.apiKey, cfg.model);
  } catch {
    return embedLocal(text);
  }
}

export async function embedOllamaOrLocalBatch(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  const cfg = await resolveOllama();
  if (!cfg) return embedLocalBatch(texts);
  const out: Float32Array[] = [];
  for (const text of texts) {
    try {
      out.push(await fetchEmbedding(text, cfg.baseUrl, cfg.apiKey, cfg.model));
    } catch {
      out.push(embedLocal(text));
    }
  }
  return out;
}
