/**
 * Resolve which model generates git commit messages — mirrors composer
 * fallbacks (auto → workspace last → authoring → default → first enabled).
 */

import type { ModelSelection, ProviderConfig } from '../types/provider.js';

function isValid(sel: ModelSelection | undefined, providers: readonly ProviderConfig[]): boolean {
  if (!sel) return false;
  const provider = providers.find((p) => p.id === sel.providerId && p.enabled);
  return Boolean(provider?.models?.some((m) => m.id === sel.modelId));
}

function trySel(
  sel: ModelSelection | undefined,
  providers: readonly ProviderConfig[]
): ModelSelection | null {
  return sel && isValid(sel, providers) ? sel : null;
}

function firstEnabled(providers: readonly ProviderConfig[]): ModelSelection | null {
  for (const provider of providers) {
    if (!provider.enabled) continue;
    const first = provider.models?.[0];
    if (first) return { providerId: provider.id, modelId: first.id };
  }
  return null;
}

export interface ResolveGitCommitMessageModelInput {
  providers: readonly ProviderConfig[];
  authoringModel?: ModelSelection;
  defaultModel?: ModelSelection;
  lastModelByWorkspace?: Readonly<Record<string, ModelSelection>>;
  autoModelByWorkspace?: Readonly<Record<string, boolean>>;
}

export function resolveGitCommitMessageModel(
  input: ResolveGitCommitMessageModelInput,
  workspaceId: string | null
): ModelSelection | null {
  const { providers, authoringModel, defaultModel, lastModelByWorkspace, autoModelByWorkspace } =
    input;

  if (workspaceId && autoModelByWorkspace?.[workspaceId]) {
    const fromAuto = trySel(authoringModel, providers) ?? trySel(defaultModel, providers);
    if (fromAuto) return fromAuto;
  }

  if (workspaceId) {
    const fromWorkspace = trySel(lastModelByWorkspace?.[workspaceId], providers);
    if (fromWorkspace) return fromWorkspace;
  }

  return (
    trySel(authoringModel, providers) ??
    trySel(defaultModel, providers) ??
    firstEnabled(providers)
  );
}
