import type { ModelSelection } from '@shared/types/provider.js';

/** Settings → Harness / Skills hint when an authoring model is configured. */
export function formatAuthoringModelHint(authoring: ModelSelection): string {
  return `Authoring model: ${authoring.modelId} — composer switches automatically when editing harness or skills.`;
}

export function authoringModelDiffersFrom(
  authoring: ModelSelection | undefined,
  current: ModelSelection | null | undefined
): boolean {
  if (!authoring || !current) return false;
  return (
    authoring.providerId !== current.providerId || authoring.modelId !== current.modelId
  );
}
