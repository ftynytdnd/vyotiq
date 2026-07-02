import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { focusComposer } from '../lib/focusComposer.js';
import { Timeline } from '../components/timeline/Timeline.js';
import { RevertPromptProvider } from '../components/timeline/revert/RevertPromptContext.js';
import { ChatFooter } from './ChatFooter.js';
import { ChatLandingSetup } from './ChatLandingSetup.js';
import { useLandingConversationPrewarm } from './useLandingConversationPrewarm.js';
import { useChatStore } from '../store/useChatStore.js';
import { useProviderStore } from '../store/useProviderStore.js';
import { useSettingsStore } from '../store/useSettingsStore.js';
import { useConversationsStore, useActiveConversationId } from '../store/useConversationsStore.js';
import type { ModelSelection } from '@shared/types/provider.js';
import { useWorkspaceStore } from '../store/useWorkspaceStore.js';
import { cn } from '../lib/cn.js';
import {
  timelineAgentColumnMaxWidth,
  timelineContentWidthClass
} from '../lib/timelineContentWidth.js';
import { LoadingHint } from '../components/ui/LoadingHint.js';
import { RegionErrorBoundary } from '../components/RegionErrorBoundary.js';
import { useProviderAccountPollSource } from '../lib/useProviderAccountPollSource.js';
import { useWorkbenchActive } from '../components/workbench/useWorkbenchActive.js';
import { openWorkspaceLauncher } from '../store/useWorkspaceLauncherStore.js';
import { useUiStore } from '../store/useUiStore.js';
import { useComposerModelBridgeStore } from '../store/useComposerModelBridgeStore.js';
import {
  enrichModelSelection,
  isComposerModelValid,
  resolveComposerModel
} from '../lib/resolveComposerModel.js';

interface ChatPageProps {
  onOpenProviders: () => void;
}

export function ChatPage({ onOpenProviders }: ChatPageProps) {
  const events = useChatStore((s) => s.events);
  const providers = useProviderStore((s) => s.providers);
  const workspaceInfo = useWorkspaceStore((s) => s.info);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeId);
  const settings = useSettingsStore((s) => s.settings);
  const setLastModelByWorkspace = useSettingsStore((s) => s.setLastModelByWorkspace);
  const activeConversationId = useActiveConversationId();
  const { conversationList, selecting } = useConversationsStore(
    useShallow((s) => ({ conversationList: s.list, selecting: s.selecting }))
  );
  const isProcessing = useChatStore((s) => s.isProcessing);
  const workbenchActive = useWorkbenchActive();

  useProviderAccountPollSource('agent-run', isProcessing);

  const contentWidth = timelineContentWidthClass(workbenchActive);
  const agentColumnMaxWidth = timelineAgentColumnMaxWidth(workbenchActive);

  const [model, setModel] = useState<ModelSelection | null>(null);
  const authoringEditNonce = useComposerModelBridgeStore((s) => s.authoringEditNonce);

  const autoModelEnabled = Boolean(
    activeWorkspaceId && settings.ui?.autoModelByWorkspace?.[activeWorkspaceId]
  );

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
    const resolved = resolveComposerModel({
      providers,
      activeConversationId,
      conversationList,
      activeWorkspaceId,
      lastModelByWorkspace: settings.ui?.lastModelByWorkspace ?? {},
      defaultModel: settings.defaultModel,
      authoringModel: settings.authoringModel,
      autoModelEnabled
    });
    if (resolved) setModel(resolved);
  }, [
    providers,
    settings.defaultModel,
    settings.authoringModel,
    settings.ui?.lastModelByWorkspace,
    model,
    activeConversationId,
    activeWorkspaceId,
    conversationList,
    autoModelEnabled
  ]);

  useEffect(() => {
    if (!authoringEditNonce) return;
    const authoring = settings.authoringModel;
    if (!authoring || !isComposerModelValid(authoring, providers)) return;
    const sel = enrichModelSelection(authoring, providers);
    setModel(sel);
    if (activeWorkspaceId) {
      void setLastModelByWorkspace(activeWorkspaceId, sel);
    }
  }, [
    authoringEditNonce,
    settings.authoringModel,
    providers,
    activeWorkspaceId,
    setLastModelByWorkspace
  ]);

  const defaultModelKey = settings.defaultModel
    ? `${settings.defaultModel.providerId}::${settings.defaultModel.modelId}`
    : '';
  const prevDefaultKeyRef = useRef<string | undefined>(undefined);
  const defaultBootCapturedRef = useRef(false);
  useEffect(() => {
    const prev = prevDefaultKeyRef.current;
    prevDefaultKeyRef.current = defaultModelKey;
    if (prev === undefined && defaultModelKey === '') return;
    if (!defaultBootCapturedRef.current && defaultModelKey !== '') {
      defaultBootCapturedRef.current = true;
      return;
    }
    if (prev === defaultModelKey) return;
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

  const handleModelChange = (sel: ModelSelection) => {
    setModel(sel);
    if (activeWorkspaceId) {
      void setLastModelByWorkspace(activeWorkspaceId, sel);
    }
  };

  const isFresh = events.length === 0;
  const hasProviders = useMemo(
    () => providers.some((p) => p.enabled && (p.models?.length ?? 0) > 0),
    [providers]
  );
  const hasWorkspace = Boolean(workspaceInfo.path);
  const needsSetup = !hasWorkspace || !hasProviders;
  /** Empty chat — center the composer when chat owns the canvas (companion closed). */
  const centerComposer = isFresh && !workbenchActive;
  const [jumpOverlayHost, setJumpOverlayHost] = useState<HTMLElement | null>(null);
  const prevCenterComposerRef = useRef(centerComposer);
  const [dockingFromCenter, setDockingFromCenter] = useState(false);

  const focusSession = activeConversationId ?? 'landing';
  const requestComposerFocus = !selecting && !needsSetup;

  useEffect(() => {
    if (!requestComposerFocus) return;
    focusComposer();
  }, [requestComposerFocus, focusSession]);

  useLandingConversationPrewarm({
    enabled: centerComposer,
    needsSetup,
    selecting,
    activeWorkspaceId
  });

  useEffect(() => {
    if (prevCenterComposerRef.current && !centerComposer) {
      setDockingFromCenter(true);
      const id = window.setTimeout(() => setDockingFromCenter(false), 220);
      prevCenterComposerRef.current = centerComposer;
      return () => window.clearTimeout(id);
    }
    prevCenterComposerRef.current = centerComposer;
  }, [centerComposer]);

  const setupLead = (
    <ChatLandingSetup
      hasWorkspace={hasWorkspace}
      hasProviders={hasProviders}
      landing={centerComposer}
      workspaceId={activeWorkspaceId}
      workspaceLabel={workspaceInfo.label}
      onPickWorkspace={() => {
        useUiStore.getState().setDockExpanded(true);
        openWorkspaceLauncher('local', 'inline');
      }}
      onConnectGitHub={() => {
        useUiStore.getState().setDockExpanded(true);
        openWorkspaceLauncher('github', 'inline');
      }}
      onOpenProviders={onOpenProviders}
    />
  );

  return (
    <RevertPromptProvider
      model={model}
      onModelChange={handleModelChange}
      onOpenProviders={onOpenProviders}
    >
      <div className="relative flex min-h-0 w-full flex-1 flex-col overflow-hidden">
          {selecting && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface-base/80">
              <LoadingHint message="Loading conversation…" />
            </div>
          )}
          {centerComposer ? (
            <RegionErrorBoundary label="Composer">
              <ChatFooter
              centered
              landing
              setupLead={setupLead}
              showShortcutHints={!needsSetup}
              contentWidth={contentWidth}
              model={model}
              onModelChange={handleModelChange}
              onOpenProviders={onOpenProviders}
              jumpOverlayHostRef={setJumpOverlayHost}
              requestFocus={requestComposerFocus}
              focusSession={focusSession}
            />
            </RegionErrorBoundary>
          ) : (
            <>
              <div
                className="scrollbar-stealth vx-timeline-scroll-host min-h-0 flex-1 overflow-y-auto px-4 antialiased"
                style={
                  {
                    '--timeline-agent-max-w': agentColumnMaxWidth
                  } as CSSProperties
                }
              >
                <div
                  className={cn(
                    'mx-auto flex w-full flex-col transition-[max-width] duration-200 ease-out',
                    contentWidth
                  )}
                >
                  <RegionErrorBoundary label="Timeline">
                    <Timeline
                      model={model}
                      onOpenProviders={onOpenProviders}
                      jumpOverlayHost={jumpOverlayHost}
                      promptAnchorEnter={dockingFromCenter}
                    />
                  </RegionErrorBoundary>
                </div>
              </div>
              <RegionErrorBoundary label="Composer">
                <ChatFooter
                  contentWidth={contentWidth}
                  model={model}
                  onModelChange={handleModelChange}
                  onOpenProviders={onOpenProviders}
                  jumpOverlayHostRef={setJumpOverlayHost}
                  dockingFromCenter={dockingFromCenter}
                  requestFocus={requestComposerFocus}
                  focusSession={focusSession}
                />
              </RegionErrorBoundary>
            </>
          )}
      </div>
    </RevertPromptProvider>
  );
}
