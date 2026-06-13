/**
 * Sync vector embedder choice from persisted settings (env still wins).
 */

import type { AppSettings } from '@shared/types/ipc.js';
import {
  resolveVectorMemorySettings,
  type VectorEmbedderId
} from '@shared/settings/vectorMemorySettings.js';

let cachedEmbedder: VectorEmbedderId = 'hash';

function resolveEmbedder(ui: AppSettings['ui'] | undefined): VectorEmbedderId {
  const env = process.env.VYOTIQ_VECTOR_EMBED?.trim().toLowerCase();
  if (env === 'ollama') return 'ollama';
  return resolveVectorMemorySettings(ui).embedder;
}

export function syncVectorEmbedFromSettings(settings: AppSettings): void {
  cachedEmbedder = resolveEmbedder(settings.ui);
}

export function getVectorEmbedder(): VectorEmbedderId {
  const env = process.env.VYOTIQ_VECTOR_EMBED?.trim().toLowerCase();
  if (env === 'ollama') return 'ollama';
  return cachedEmbedder;
}
