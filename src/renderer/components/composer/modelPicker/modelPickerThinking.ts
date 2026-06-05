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
  onChange: (sel: ModelSelection) => void,
  updateProvider: (
    id: string,
    patch: { modelThinking: Record<string, ThinkingEffort> }
  ) => void
): void {
  void updateProvider(providerId, { modelThinking: { [modelId]: effort } });
  onChange({ providerId, modelId, thinkingEffort: effort });
}

export function applyThinkingEffortClear(
  providerId: string,
  modelId: string,
  onChange: (sel: ModelSelection) => void,
  updateProvider: (
    id: string,
    patch: { modelThinking: Record<string, ThinkingEffort | null> }
  ) => void
): void {
  void updateProvider(providerId, { modelThinking: { [modelId]: null } });
  onChange({ providerId, modelId });
}
