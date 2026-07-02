/**
 * Resolve the composer model from conversation, workspace, and settings sources.
 */

import type { ConversationMeta } from '@shared/types/chat.js';
import type { ModelSelection, ProviderConfig } from '@shared/types/provider.js';

export function isComposerModelValid(
  sel: ModelSelection,
  providers: readonly ProviderConfig[]
): boolean {
  const provider = providers.find((p) => p.id === sel.providerId && p.enabled);
  return !!provider?.models?.some((m) => m.id === sel.modelId);
}

export function enrichModelSelection(
  sel: ModelSelection,
  providers: readonly ProviderConfig[]
): ModelSelection {
  if (sel.thinkingEffort !== undefined) return sel;
  const provider = providers.find((p) => p.id === sel.providerId);
  const stored = provider?.modelThinking?.[sel.modelId];
  if (stored !== undefined) {
    return { ...sel, thinkingEffort: stored };
  }
  return sel;
}

export interface ResolveComposerModelInput {
  providers: readonly ProviderConfig[];
  activeConversationId: string | null;
  conversationList: readonly ConversationMeta[];
  activeWorkspaceId: string | null;
  lastModelByWorkspace: Readonly<Record<string, ModelSelection>>;
  defaultModel?: ModelSelection;
  authoringModel?: ModelSelection;
  autoModelEnabled?: boolean;
}

/** Resolve auto-mode model: authoring frontier first, then default run model. */
export function resolveAutoModelSelection(
  providers: readonly ProviderConfig[],
  authoringModel?: ModelSelection,
  defaultModel?: ModelSelection
): ModelSelection | null {
  const trySel = (sel: ModelSelection | undefined): ModelSelection | null => {
    if (!sel || !isComposerModelValid(sel, providers)) return null;
    return enrichModelSelection(sel, providers);
  };
  return trySel(authoringModel) ?? trySel(defaultModel);
}

/** Priority: auto → conversation → workspace last → default → first enabled model. */
export function resolveComposerModel(input: ResolveComposerModelInput): ModelSelection | null {
  const {
    providers,
    activeConversationId,
    conversationList,
    activeWorkspaceId,
    lastModelByWorkspace,
    defaultModel,
    authoringModel,
    autoModelEnabled = false
  } = input;

  const trySel = (sel: ModelSelection | undefined): ModelSelection | null => {
    if (!sel || !isComposerModelValid(sel, providers)) return null;
    return enrichModelSelection(sel, providers);
  };

  if (autoModelEnabled) {
    const fromAuto = resolveAutoModelSelection(providers, authoringModel, defaultModel);
    if (fromAuto) return fromAuto;
  }

  if (!autoModelEnabled && activeConversationId) {
    const active = conversationList.find((c) => c.id === activeConversationId);
    if (active?.lastProviderId && active.lastModelId) {
      const fromConv = trySel({
        providerId: active.lastProviderId,
        modelId: active.lastModelId
      });
      if (fromConv) return fromConv;
    }
  }

  if (!autoModelEnabled && activeWorkspaceId) {
    const fromWorkspace = trySel(lastModelByWorkspace[activeWorkspaceId]);
    if (fromWorkspace) return fromWorkspace;
  }

  const fromDefault = trySel(defaultModel);
  if (fromDefault) return fromDefault;

  for (const provider of providers) {
    if (!provider.enabled) continue;
    const first = provider.models?.[0];
    if (first) {
      return enrichModelSelection({ providerId: provider.id, modelId: first.id }, providers);
    }
  }

  return null;
}
