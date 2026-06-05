import type { ModelInfo, ProviderConfig } from '@shared/types/provider.js';
import { effectiveContextWindow } from '@shared/providers/contextWindow.js';
import { modelIdTail } from '@shared/providers/modelId.js';

/** Resolve a model on a provider (exact id, then tail match for `vendor/slug`). */
export function findProviderModel(
  provider: ProviderConfig,
  modelId: string
): ModelInfo | undefined {
  const models = provider.models ?? [];
  const exact = models.find((m) => m.id === modelId);
  if (exact) return exact;
  const tail = modelIdTail(modelId);
  return models.find((m) => modelIdTail(m.id) === tail);
}

export function rowContextTokens(
  model: ModelInfo,
  provider: ProviderConfig
): number | undefined {
  return effectiveContextWindow(model, provider.contextOverrides);
}

export function applyContextOverrideChange(
  providerId: string,
  modelId: string,
  tokens: number,
  updateProvider: (
    id: string,
    patch: { contextOverrides: Record<string, number> }
  ) => void
): void {
  void updateProvider(providerId, { contextOverrides: { [modelId]: tokens } });
}

export function applyContextOverrideClear(
  providerId: string,
  modelId: string,
  updateProvider: (
    id: string,
    patch: { contextOverrides: Record<string, number | null> }
  ) => void
): void {
  void updateProvider(providerId, { contextOverrides: { [modelId]: null } });
}
