import type { ModelInfo, ProviderConfig } from '../types/provider.js';

/** Route slug tail after the last `/` (`openai/o1` → `o1`). */
export function modelIdTail(modelId: string): string {
  const slash = modelId.lastIndexOf('/');
  return slash >= 0 ? modelId.slice(slash + 1) : modelId;
}

/** Resolve a model on a provider (exact id, then tail match for `vendor/slug`). */
export function findProviderModel(
  provider: Pick<ProviderConfig, 'models'>,
  modelId: string
): ModelInfo | undefined {
  const models = provider.models ?? [];
  const exact = models.find((m) => m.id === modelId);
  if (exact) return exact;
  const tail = modelIdTail(modelId);
  return models.find((m) => modelIdTail(m.id) === tail);
}
