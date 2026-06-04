import type { ModelSelection, ProviderConfig, ThinkingEffort } from '@shared/types/provider.js';
export { effortDisplayLabel as rowEffortInlineLabel } from '@shared/providers/thinkingEffort.js';

/** Effort shown on a picker row (session override wins for the active model). */
export function rowThinkingEffort(
  provider: ProviderConfig,
  modelId: string,
  selection: ModelSelection | null
): ThinkingEffort | undefined {
  const stored = provider.modelThinking?.[modelId];
  if (
    selection?.providerId === provider.id &&
    selection.modelId === modelId &&
    selection.thinkingEffort !== undefined
  ) {
    return selection.thinkingEffort;
  }
  return stored;
}

export function applyThinkingEffortChange(
  providerId: string,
  modelId: string,
  effort: ThinkingEffort,
  selection: ModelSelection | null,
  onChange: (sel: ModelSelection) => void,
  updateProvider: (
    id: string,
    patch: { modelThinking: Record<string, ThinkingEffort> }
  ) => void
): void {
  void updateProvider(providerId, { modelThinking: { [modelId]: effort } });
  if (selection?.providerId === providerId && selection.modelId === modelId) {
    onChange({ providerId, modelId, thinkingEffort: effort });
  }
}

export function applyThinkingEffortClear(
  providerId: string,
  modelId: string,
  selection: ModelSelection | null,
  onChange: (sel: ModelSelection) => void,
  updateProvider: (
    id: string,
    patch: { modelThinking: Record<string, ThinkingEffort | null> }
  ) => void
): void {
  void updateProvider(providerId, { modelThinking: { [modelId]: null } });
  if (selection?.providerId === providerId && selection.modelId === modelId) {
    onChange({ providerId, modelId });
  }
}
