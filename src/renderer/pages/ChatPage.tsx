import { useEffect, useMemo, useRef, useState } from 'react';
import { Composer } from '../components/composer/Composer.js';
import { Timeline } from '../components/timeline/Timeline.js';
import { RevertPromptProvider } from '../components/timeline/revert/RevertPromptContext.js';
import { PendingChangesPanel } from '../components/checkpoints/PendingChangesPanel.js';
import { useChatStore } from '../store/useChatStore.js';
import { useProviderStore } from '../store/useProviderStore.js';
import { useSettingsStore } from '../store/useSettingsStore.js';
import { useConversationsStore, useActiveConversationId } from '../store/useConversationsStore.js';
import type { ModelSelection } from '@shared/types/provider.js';
import { useWorkspaceStore } from '../store/useWorkspaceStore.js';
import { Button } from '../components/ui/Button.js';
import { FolderOpen } from 'lucide-react';
import { AGENT_NAME } from '@shared/constants.js';

interface ChatPageProps {
  onOpenProviders: () => void;
  /**
   * Opens the Checkpoints modal. Threaded down so the
   * `PendingChangesPanel` can offer a "View history" link inside its
   * empty-state row and a disk-usage pill in its header without
   * needing to know how the modal is mounted.
   */
  onOpenCheckpoints: () => void;
}

export function ChatPage({ onOpenProviders, onOpenCheckpoints }: ChatPageProps) {
  const events = useChatStore((s) => s.events);
  const providers = useProviderStore((s) => s.providers);
  const workspaceInfo = useWorkspaceStore((s) => s.info);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeId);
  const pickWorkspace = useWorkspaceStore((s) => s.pick);
  const settings = useSettingsStore((s) => s.settings);
  const activeConversationId = useActiveConversationId();
  const conversationList = useConversationsStore((s) => s.list);

  const [model, setModel] = useState<ModelSelection | null>(null);

  const prevConvIdRef = useRef<string | null>(activeConversationId);
  useEffect(() => {
    const prev = prevConvIdRef.current;
    prevConvIdRef.current = activeConversationId;
    if (prev !== null && activeConversationId !== null && prev !== activeConversationId) {
      setModel(null);
    }
  }, [activeConversationId]);

  useEffect(() => {
    if (model) return;
    // Resolution order:
    //   1. Conversation-level last-used model (most specific).
    //   2. Workspace-level last-used model (fresh chat in a workspace
    //      should default to the model that workspace was last using
    //      rather than the app-wide default).
    //   3. Global `defaultModel`.
    //   4. First enabled provider's first model.
    // At every step we validate the model is still available on an
    // enabled provider — a model that was uninstalled / disabled
    // since the preference was written silently falls through.
    const active = conversationList.find((c) => c.id === activeConversationId);
    if (active?.lastProviderId && active.lastModelId) {
      const p = providers.find((p) => p.id === active.lastProviderId && p.enabled);
      if (p?.models?.some((m) => m.id === active.lastModelId)) {
        setModel({ providerId: active.lastProviderId, modelId: active.lastModelId });
        return;
      }
    }
    if (activeWorkspaceId) {
      const wsLast = settings.ui?.lastModelByWorkspace?.[activeWorkspaceId];
      if (wsLast) {
        const p = providers.find((p) => p.id === wsLast.providerId && p.enabled);
        if (p?.models?.some((m) => m.id === wsLast.modelId)) {
          setModel({ providerId: wsLast.providerId, modelId: wsLast.modelId });
          return;
        }
      }
    }
    const def = settings.defaultModel;
    if (def) {
      const p = providers.find((p) => p.id === def.providerId && p.enabled);
      if (p?.models?.some((m) => m.id === def.modelId)) {
        setModel(def);
        return;
      }
    }
    for (const p of providers) {
      if (!p.enabled) continue;
      const m = p.models?.[0];
      if (m) {
        setModel({ providerId: p.id, modelId: m.id });
        return;
      }
    }
  }, [
    providers,
    settings.defaultModel,
    settings.ui?.lastModelByWorkspace,
    model,
    activeConversationId,
    activeWorkspaceId,
    conversationList
  ]);

  const isFresh = events.length === 0;
  const hasProviders = useMemo(() => providers.some((p) => p.enabled && (p.models?.length ?? 0) > 0), [providers]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="scrollbar-stealth flex-1 overflow-y-auto px-6 pb-2">
        <div className="mx-auto w-full max-w-3xl">
          {isFresh && (
            <div className="flex min-h-[64vh] flex-col items-center justify-center px-2 pb-8 pt-8 text-center">
              <div className="text-body font-semibold tracking-[-0.01em] text-text-primary">
                What can {AGENT_NAME} help you with today?
              </div>

              {/*
                Empty-state setup rows stay flush and minimal: muted text
                plus one primary Button when action is required. No card
                chrome or suggestion grid.
              */}
              {!workspaceInfo.path && (
                <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                  <span className="text-row text-text-muted">
                    Pick a workspace to begin.
                  </span>
                  <Button variant="primary" size="sm" onClick={() => void pickWorkspace()}>
                    <FolderOpen className="h-3 w-3" strokeWidth={2.25} />
                    Open workspace…
                  </Button>
                </div>
              )}

              {workspaceInfo.path && !hasProviders && (
                <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                  <span className="text-row text-text-muted">
                    No AI provider configured yet.
                  </span>
                  <Button variant="primary" size="sm" onClick={onOpenProviders}>
                    Configure provider
                  </Button>
                </div>
              )}
            </div>
          )}

          <RevertPromptProvider model={model}>
            <Timeline model={model} />
          </RevertPromptProvider>
        </div>
      </div>

      <div className="px-6 pt-2 pb-2">
        <div className="mx-auto w-full max-w-3xl">
          {/* Pending checkpoint changes for the active conversation. The
              panel auto-hides when the list is empty so the chat surface
              stays clean. Mounted ABOVE the Composer so it sits naturally
              between the timeline tail and the input. */}
          <PendingChangesPanel
            conversationId={activeConversationId}
            onOpenCheckpoints={onOpenCheckpoints}
          />
          <Composer
            model={model}
            onModelChange={setModel}
            onOpenProviders={onOpenProviders}
          />
        </div>
      </div>
    </div>
  );
}
