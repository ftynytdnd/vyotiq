/**
 * Resolved defaults for `settings.ui.vectorMemory`.
 */

import type { AppSettings } from '../types/ipc.js';

export type VectorEmbedderId = 'hash' | 'ollama';

export interface ResolvedVectorMemorySettings {
  embedder: VectorEmbedderId;
  ollamaBaseUrl: string;
  ollamaModel: string;
}

const DEFAULT_OLLAMA_BASE = 'http://localhost:11434';
const DEFAULT_OLLAMA_MODEL = 'nomic-embed-text';

export function resolveVectorMemorySettings(
  ui: AppSettings['ui'] | undefined
): ResolvedVectorMemorySettings {
  const vm = ui?.vectorMemory;
  const embedder: VectorEmbedderId = vm?.embedder === 'ollama' ? 'ollama' : 'hash';
  return {
    embedder,
    ollamaBaseUrl:
      typeof vm?.ollamaBaseUrl === 'string' && vm.ollamaBaseUrl.trim()
        ? vm.ollamaBaseUrl.trim()
        : DEFAULT_OLLAMA_BASE,
    ollamaModel:
      typeof vm?.ollamaModel === 'string' && vm.ollamaModel.trim()
        ? vm.ollamaModel.trim()
        : DEFAULT_OLLAMA_MODEL
  };
}
