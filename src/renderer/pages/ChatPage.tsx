import { useEffect, useMemo, useRef, useState } from 'react';
import { Timeline } from '../components/timeline/Timeline.js';
import { RevertPromptProvider } from '../components/timeline/revert/RevertPromptContext.js';
import { AskUserOverlayHost } from '../components/timeline/askUser/AskUserOverlayHost.js';
import { ChatFooter } from './ChatFooter.js';
import { useChatStore } from '../store/useChatStore.js';
import { useProviderStore } from '../store/useProviderStore.js';
import { useSettingsStore } from '../store/useSettingsStore.js';
import { useConversationsStore, useActiveConversationId } from '../store/useConversationsStore.js';
import type { ModelSelection } from '@shared/types/provider.js';
import { useWorkspaceStore } from '../store/useWorkspaceStore.js';
import { Button } from '../components/ui/Button.js';
import { FolderOpen } from 'lucide-react';
import { cn } from '../lib/cn.js';
import { SHELL_ROW_ICON_CLASS, SHELL_ROW_ICON_STROKE } from '../lib/shellIcons.js';
import { useAttachmentPreviewStore } from '../store/useAttachmentPreviewStore.js';
import { useFloatingLiveDiffStore } from '../store/useFloatingLiveDiffStore.js';

import { LoadingHint } from '../components/ui/LoadingHint.js';
import { ComposerDialogAnchor } from '../components/ui/ComposerDialogAnchor.js';

interface ChatPageProps {
  onOpenProviders: () => void;
}

export function ChatPage({ onOpenProviders }: ChatPageProps) {
  const events = useChatStore((s) => s.events);
  const providers = useProviderStore((s) => s.providers);
  const workspaceInfo = useWorkspaceStore((s) => s.info);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeId);
  const pickWorkspace = useWorkspaceStore((s) => s.pick);
  const settings = useSettingsStore((s) => s.settings);
  const setLastModelByWorkspace = useSettingsStore((s) => s.setLastModelByWorkspace);
  const activeConversationId = useActiveConversationId();
  const conversationList = useConversationsStore((s) => s.list);
  const newConversation = useConversationsStore((s) => s.newConversation);
  const selecting = useConversationsStore((s) => s.selecting);
  const previewOpen = useAttachmentPreviewStore((s) => s.attachment !== null);
  const liveDiffOpen = useFloatingLiveDiffStore((s) => s.target !== null);
  const zoneOpen = previewOpen || liveDiffOpen;

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

  // Force-apply Settings → Default model the moment the user picks it.
  //
  // The resolver effect above bails on `if (model) return;`, so any
  // post-boot change to `settings.defaultModel` would otherwise never
  // propagate to the composer — the user sees their pick land in
  // settings.json but the active model never flips. This is the
  // exact "I selected the default but nothing changed" failure mode.
  //
  // We treat a defaultModel change as a strong, intentional user
  // action: apply it to the composer immediately AND align
  // `lastModelByWorkspace[active]` so the priority chain agrees on
  // the next boot (otherwise a previously-sent message's lastUsed
  // would re-claim priority and the freshly-picked default would
  // appear to "not persist").
  //
  // Boot handling: we capture the FIRST non-empty `defaultModelKey`
  // (i.e. the value `useSettingsStore.refresh` hydrated from disk)
  // without applying. The resolver chain above already considers
  // `defaultModel` at boot — we don't want to clobber a workspace's
  // legitimate last-used model just because settings.json finished
  // loading. Only USER-driven changes after boot trigger the apply.
  const defaultModelKey = settings.defaultModel
    ? `${settings.defaultModel.providerId}::${settings.defaultModel.modelId}`
    : '';
  const prevDefaultKeyRef = useRef<string | undefined>(undefined);
  // Tracks whether we've observed at least one non-empty defaultModel
  // value. The first non-empty observation is the boot hydration —
  // captured silently. Every subsequent change (including a clear
  // back to empty, then re-set) is treated as a user action.
  const defaultBootCapturedRef = useRef(false);
  useEffect(() => {
    const prev = prevDefaultKeyRef.current;
    prevDefaultKeyRef.current = defaultModelKey;
    // Initial render before settings have hydrated — wait.
    if (prev === undefined && defaultModelKey === '') return;
    // First non-empty value after boot — capture but do not apply.
    if (!defaultBootCapturedRef.current && defaultModelKey !== '') {
      defaultBootCapturedRef.current = true;
      return;
    }
    // No actual change.
    if (prev === defaultModelKey) return;
    // User cleared the default — leave the active model alone.
    if (defaultModelKey === '') return;
    const def = settings.defaultModel;
    if (!def) return;
    const p = providers.find((p) => p.id === def.providerId && p.enabled);
    if (!p?.models?.some((m) => m.id === def.modelId)) return;
    setModel(def);
    if (activeWorkspaceId) {
      void setLastModelByWorkspace(activeWorkspaceId, def);
    }
  }, [
    defaultModelKey,
    settings.defaultModel,
    providers,
    activeWorkspaceId,
    setLastModelByWorkspace
  ]);

  // Wrap onModelChange so a composer-side pick persists immediately
  // (instead of waiting for the next send). Without this, a user who
  // picks a model and closes the app loses the choice on restart —
  // the priority chain falls back to whatever was sent last. Writing
  // through to `lastModelByWorkspace[active]` here makes the picker
  // a first-class persistent preference and matches the user's
  // mental model: "what I see in the composer is what I'll get next
  // time."
  //
  // The setter identity-skips a same-value re-write (see the matching
  // guard inside `useSettingsStore.setLastModelByWorkspace`) so a
  // misclick that lands on the current value doesn't churn
  // settings.json.
  const handleModelChange = (sel: ModelSelection) => {
    setModel(sel);
    if (activeWorkspaceId) {
      void setLastModelByWorkspace(activeWorkspaceId, sel);
    }
  };

  const isFresh = events.length === 0;
  const hasProviders = useMemo(() => providers.some((p) => p.enabled && (p.models?.length ?? 0) > 0), [providers]);
  const needsSetup = !workspaceInfo.path || !hasProviders;
  const emptyMinH = needsSetup ? 'min-h-[40vh]' : 'min-h-0 flex-1';
  /** Adaptive reading width — narrows when the secondary zone is open. */
  const contentWidth = zoneOpen ? 'max-w-2xl' : 'max-w-3xl';

  return (
    <RevertPromptProvider
      model={model}
      onModelChange={handleModelChange}
      onOpenProviders={onOpenProviders}
    >
    <div className="flex h-full flex-col overflow-hidden">
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {selecting && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface-base/80">
            <LoadingHint message="Loading conversation…" />
          </div>
        )}
      <div className="scrollbar-stealth flex-1 overflow-y-auto scroll-pb-6 px-4 pb-8 antialiased">
        <div
          className={cn(
            'mx-auto flex w-full flex-col transition-[max-width] duration-200 ease-out',
            contentWidth,
            isFresh && !needsSetup && 'min-h-full justify-center'
          )}
        >
          {isFresh && !needsSetup && !activeConversationId && (
            <div
              className={cn(
                'flex flex-col items-center justify-center gap-3 px-2 pb-8 pt-6 text-center',
                emptyMinH
              )}
            >
              <div className="text-body font-medium text-text-primary">Start a conversation</div>
              <p className="max-w-md text-row text-text-muted">
                Pick an existing chat in the dock or create a new one to begin.
              </p>
              <Button variant="secondary" size="sm" onClick={() => void newConversation()}>
                New chat
              </Button>
            </div>
          )}

          {isFresh && needsSetup && (
            <div className={cn('flex flex-col items-start justify-center px-2 pb-8 pt-6', emptyMinH)}>
              {!workspaceInfo.path ? (
                <>
                  <div className="text-body font-medium tracking-normal text-text-primary">
                    Open a workspace to begin
                  </div>
                  <div className="mt-2 max-w-md text-row text-text-muted">
                    Agent V runs inside a folder on your machine. Pick one to sandbox tools and memory.
                  </div>
                </>
              ) : null}

              {!workspaceInfo.path && (
                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <span className="text-row text-text-muted">Pick a workspace to begin.</span>
                  <Button variant="link" size="sm" onClick={() => void pickWorkspace()}>
                    <FolderOpen
                      className={SHELL_ROW_ICON_CLASS}
                      strokeWidth={SHELL_ROW_ICON_STROKE}
                      aria-hidden
                    />
                    Open workspace…
                  </Button>
                </div>
              )}

              {workspaceInfo.path && !hasProviders && (
                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <span className="text-row text-text-muted">No AI provider configured yet.</span>
                  <Button variant="link" size="sm" onClick={onOpenProviders}>
                    Configure provider
                  </Button>
                </div>
              )}
            </div>
          )}

          <Timeline model={model} />
        </div>
      </div>
      </div>

      <div className="shrink-0 px-4">
        <div
          className={cn(
            'mx-auto w-full transition-[max-width] duration-200 ease-out',
            contentWidth
          )}
        >
          <ComposerDialogAnchor className="vx-composer-dialog-slot empty:hidden" />
          <AskUserOverlayHost />
        </div>
      </div>

      <ChatFooter
        contentWidth={contentWidth}
        model={model}
        onModelChange={handleModelChange}
        onOpenProviders={onOpenProviders}
      />
    </div>
    </RevertPromptProvider>
  );
}
