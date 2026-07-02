/**
 * Display label for the model used to generate commit messages.
 */

import type { ModelSelection, ProviderConfig } from '@shared/types/provider.js';

export function formatCommitMessageModelLabel(
  model: ModelSelection,
  providers: readonly ProviderConfig[]
): string {
  const provider = providers.find((p) => p.id === model.providerId);
  const name = provider?.name?.trim() || model.providerId;
  return `${name} · ${model.modelId}`;
}
