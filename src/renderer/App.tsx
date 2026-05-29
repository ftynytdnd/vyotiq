import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/react/shallow';
import { TitleBar } from './components/titlebar/TitleBar.js';
import { LeftDock } from './components/dock/index.js';
import { SecondaryZone } from './components/zone/index.js';
import { ChatPage } from './pages/ChatPage.js';
import { ToastHost } from './components/toast/ToastHost.js';
import { LoadingHint } from './components/ui/LoadingHint.js';
// Lazy-loaded composer dialogs. ConfirmHost and PromptDialog portal
// into the `ComposerDialogAnchor` slot above the chat composer
// (Settings, Checkpoints, and Context Inspector live in the
// right-hand SecondaryZone instead).
const ConfirmHost = lazy(() =>
  retryDynamicImport(() =>
    import('./components/confirm/ConfirmHost.js').then((m) => ({ default: m.ConfirmHost }))
  )
);
const PromptDialog = lazy(() =>
  retryDynamicImport(() =>
    import('./components/ui/PromptDialog.js').then((m) => ({ default: m.PromptDialog }))
  )
);
import {
  selectEnabledProviderIds,
  useProviderStore
} from './store/useProviderStore.js';
import { retryDynamicImport } from './lib/retryDynamicImport.js';
import { useWorkspaceStore } from './store/useWorkspaceStore.js';
import { useSettingsStore, selectSettingsReady } from './store/useSettingsStore.js';
import { useToastStore } from './store/useToastStore.js';
import { useConversationsStore } from './store/useConversationsStore.js';
import { useChatStore } from './store/useChatStore.js';
import { useUiStore } from './store/useUiStore.js';
import { useTimelineUiStore } from './store/useTimelineUiStore.js';
import { useCheckpointsStore } from './store/useCheckpointsStore.js';
import {
  useSecondaryZoneStore,
  type SettingsTabId
} from './store/useSecondaryZoneStore.js';
import { usePersistedPanelWidth } from './hooks/usePersistedPanelWidth.js';
import { vyotiq } from './lib/ipc.js';
import { logger } from './lib/logger.js';
import { openContextInspectorForActiveChat } from './lib/openContextInspector.js';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts.js';
import {
  applyAppTheme,
  stopWatchSystemTheme,
  themePrefsFromSettings,
  watchSystemTheme
} from './lib/theme.js';
import { AttachmentPreviewPanel } from './components/composer/AttachmentPreviewPanel.js';
import { useAttachmentPreviewStore } from './store/useAttachmentPreviewStore.js';
import { LiveDiffFloatingPanel } from './components/timeline/LiveDiffFloatingPanel.js';
import { useFloatingLiveDiffStore } from './store/useFloatingLiveDiffStore.js';

const log = logger.child('app');

export default function App() {
  const refreshProviders = useProviderStore((s) => s.refresh);
  const discoverCached = useProviderStore((s) => s.discoverCached);
  const enabledProviderIds = useProviderStore(
    useShallow((s) => selectEnabledProviderIds(s.providers))
  );
  const refreshWorkspace = useWorkspaceStore((s) => s.refresh);
  const refreshSettings = useSettingsStore((s) => s.refresh);
  const refreshConversations = useConversationsStore((s) => s.refresh);
  const settings = useSettingsStore((s) => s.settings);
  const settingsReady = useSettingsStore(selectSettingsReady);
  const { hydrateUi, uiHydrated } = useUiStore(
    useShallow((s) => ({ hydrateUi: s.hydrate, uiHydrated: s.hydrated }))
  );
  const { hydrateTimelineUi, timelineUiHydrated } = useTimelineUiStore(
    useShallow((s) => ({ hydrateTimelineUi: s.hydrate, timelineUiHydrated: s.hydrated }))
  );
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeId);
  const {
    hydrateActiveByWorkspace,
    select: selectConversation,
    list: conversationsList,
    activeIdByWorkspace,
    prewarm: prewarmConversation,
    newConversation
  } = useConversationsStore(
    useShallow((s) => ({
      hydrateActiveByWorkspace: s.hydrateActiveByWorkspace,
      select: s.select,
      list: s.list,
      activeIdByWorkspace: s.activeIdByWorkspace,
      prewarm: s.prewarm,
      newConversation: s.newConversation
    }))
  );
  const [activeMapHydrated, setActiveMapHydrated] = useState(false);

  const [workspacePathOpen, setWorkspacePathOpen] = useState(false);
  const [workspacePathError, setWorkspacePathError] = useState<string | null>(null);
  const initCheckpoints = useCheckpointsStore((s) => s.initOnce);
  const {
    openSettings: openSecondarySettings,
    openCheckpoints: openSecondaryCheckpoints,
    panel: secondaryPanel,
    closeAllOverlays
  } = useSecondaryZoneStore(
    useShallow((s) => ({
      openSettings: s.openSettings,
      openCheckpoints: s.openCheckpoints,
      panel: s.panel,
      closeAllOverlays: s.closeAllOverlays
    }))
  );
  const { previewAttachment, closePreview } = useAttachmentPreviewStore(
    useShallow((s) => ({ previewAttachment: s.attachment, closePreview: s.close }))
  );
  const { liveDiffTarget, dismissLiveDiff } = useFloatingLiveDiffStore(
    useShallow((s) => ({ liveDiffTarget: s.target, dismissLiveDiff: s.dismiss }))
  );
  const attachmentPreviewWidth = usePersistedPanelWidth('attachmentPreview');
  const dockExpanded = useUiStore((s) => s.dockExpanded);
  const overlayOpen =
    secondaryPanel !== null ||
    previewAttachment !== null ||
    liveDiffTarget !== null;
  const showToast = useToastStore((s) => s.show);
  const updateCheckDone = useRef(false);

  // Foundational data: providers, workspace, settings, conversations.
  useEffect(() => {
    void refreshProviders();
    void refreshWorkspace();
    void refreshSettings();
    void refreshConversations();
  }, [refreshProviders, refreshWorkspace, refreshSettings, refreshConversations]);

  // Subscribe to main-process checkpoint-store mutations so any cached
  // pending list / summary refreshes the moment a different code path
  // (e.g. another renderer-side accept, or a sub-agent edit landing
  // mid-run) changes the store. Returns the unsubscribe handle.
  useEffect(() => {
    return initCheckpoints();
  }, [initCheckpoints]);

  // Hydrate UI prefs (left dock expand state + per-workspace collapse
  // state) from persisted settings exactly once, after the settings
  // refresh has resolved. Subsequent toggles self-persist via the ui
  // store.
  useEffect(() => {
    if (!settingsReady || uiHydrated) return;
    const collapsed = settings.ui?.collapsedWorkspaces;
    const dockExpanded =
      settings.ui?.dockExpanded ??
      (settings.ui?.sidebarOpen !== undefined ? settings.ui.sidebarOpen : false);
    hydrateUi({
      dockExpanded,
      dockWidth: settings.ui?.dockWidth,
      collapsedWorkspaces: collapsed
    });
    if (
      settings.ui?.sidebarOpen !== undefined &&
      settings.ui?.dockExpanded === undefined
    ) {
      void vyotiq.settings.set({
        ui: {
          ...(settings.ui ?? {}),
          dockExpanded,
          sidebarOpen: undefined
        }
      });
    }
  }, [settings, settingsReady, uiHydrated, hydrateUi]);

  useEffect(() => {
    if (!settingsReady) return;
    const prefs = themePrefsFromSettings(settings);
    applyAppTheme(prefs);
    watchSystemTheme(() => {}, () => themePrefsFromSettings(useSettingsStore.getState().settings));
    return () => stopWatchSystemTheme();
  }, [settings, settingsReady]);

  useEffect(() => {
    if (!settingsReady) return;
    if (settings.ui?.firstLaunch) {
      openSecondarySettings('appearance');
      void vyotiq.settings.set({
        ui: { ...settings.ui, firstLaunch: false, lastSettingsTab: 'appearance' }
      });
    }
  }, [settings, settingsReady, openSecondarySettings]);

  // Auto-check for updates once after settings hydrate (packaged builds only).
  useEffect(() => {
    if (!settingsReady || updateCheckDone.current) return;
    updateCheckDone.current = true;
    let cancelled = false;
    void vyotiq.app
      .checkForUpdates()
      .then((result) => {
        if (cancelled || !result.updateAvailable) return;
        showToast(
          result.version ? `Update available: v${result.version}` : 'Update available',
          'success'
        );
      })
      .catch(() => {
        /* silent on launch — About tab manual check surfaces errors */
      });
    return () => {
      cancelled = true;
    };
  }, [settingsReady, showToast]);

  // Hydrate persisted timeline expand/collapse state exactly once after
  // the first settings refresh resolves. Cheap — just a
  // Record<string, string[]> snapshot.
  useEffect(() => {
    if (!settingsReady || timelineUiHydrated) return;
    hydrateTimelineUi(settings.ui?.expandedRows);
  }, [settings, settingsReady, timelineUiHydrated, hydrateTimelineUi]);

  // Hydrate the per-workspace last-active conversation map from
  // persisted settings exactly once after the first settings refresh
  // resolves. Subsequent edits self-persist via
  // `useConversationsStore.persistActiveMap`.
  useEffect(() => {
    if (!settingsReady || activeMapHydrated) return;
    hydrateActiveByWorkspace(settings.ui?.activeConversationByWorkspace ?? {});
    setActiveMapHydrated(true);
  }, [settings, settingsReady, activeMapHydrated, hydrateActiveByWorkspace]);

  // Pre-warm sibling transcripts after first idle so the FIRST
  // switch into ANY persisted-active workspace's last conversation is
  // instant (no JSONL re-read on the click). The active workspace's
  // own slot is skipped — `select(id)` further down hydrates it
  // already. We use `requestIdleCallback` when available (avoids
  // contending with first-paint work) and fall back to a 200 ms
  // `setTimeout`. Each prewarm is fire-and-forget; failures are
  // logged inside `useConversationsStore.prewarm`.
  const [prewarmDone, setPrewarmDone] = useState(false);
  useEffect(() => {
    if (prewarmDone) return;
    if (!activeMapHydrated) return;
    if (conversationsList.length === 0) return;
    const slots = Object.entries(activeIdByWorkspace).filter(
      ([wsId, convId]) =>
        typeof convId === 'string' &&
        convId.length > 0 &&
        wsId !== activeWorkspaceId
    );
    if (slots.length === 0) {
      setPrewarmDone(true);
      return;
    }
    const ric =
      typeof (window as unknown as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback ===
        'function'
        ? (window as unknown as { requestIdleCallback: (cb: () => void) => number }).requestIdleCallback
        : null;
    const cancelRic =
      typeof (window as unknown as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback ===
        'function'
        ? (window as unknown as { cancelIdleCallback: (h: number) => void }).cancelIdleCallback
        : null;
    let handle: number | null = null;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const run = () => {
      // Validate each slot against the FULL list before warming —
      // a stale persisted slot may point at a conversation that
      // was removed in a previous boot.
      for (const [, convId] of slots) {
        const exists = conversationsList.some((m) => m.id === convId);
        if (!exists) continue;
        void prewarmConversation(convId as string);
      }
      setPrewarmDone(true);
    };
    if (ric) {
      handle = ric(run);
    } else {
      timeout = setTimeout(run, 200);
    }
    return () => {
      if (handle !== null && cancelRic) cancelRic(handle);
      if (timeout) clearTimeout(timeout);
    };
  }, [
    prewarmDone,
    activeMapHydrated,
    activeIdByWorkspace,
    activeWorkspaceId,
    conversationsList,
    prewarmConversation
  ]);

  const slotIsValidForWorkspace = useMemo(() => {
    if (!activeWorkspaceId) return false;
    const targetId = activeIdByWorkspace[activeWorkspaceId] ?? null;
    return (
      targetId !== null &&
      conversationsList.some((m) => m.id === targetId && m.workspaceId === activeWorkspaceId)
    );
  }, [activeWorkspaceId, activeIdByWorkspace, conversationsList]);

  const activeSlotConversationId =
    activeWorkspaceId && slotIsValidForWorkspace
      ? (activeIdByWorkspace[activeWorkspaceId] ?? null)
      : null;

  // Workspace switch: follow the persisted last-active slot for the
  // newly active workspace. Skip when the mirror already shows that
  // hydrated conversation — avoids redundant `select()` supersede churn.
  useEffect(() => {
    if (!activeMapHydrated || !activeWorkspaceId) return;
    if (!slotIsValidForWorkspace || !activeSlotConversationId) {
      useChatStore.getState().setActiveConversation(null);
      return;
    }
    const chat = useChatStore.getState();
    const conv = useConversationsStore.getState();
    if (
      chat.conversationId === activeSlotConversationId &&
      conv.hydratedIds.has(activeSlotConversationId)
    ) {
      return;
    }
    void selectConversation(activeSlotConversationId);
  }, [
    activeMapHydrated,
    activeWorkspaceId,
    activeSlotConversationId,
    slotIsValidForWorkspace,
    selectConversation
  ]);

  // List validation: once the conversation catalogue arrives, re-check
  // that the active workspace slot still resolves. Does not re-select
  // when the user is already viewing a valid hydrated conversation.
  useEffect(() => {
    if (!activeMapHydrated || !activeWorkspaceId || conversationsList.length === 0) return;
    if (!slotIsValidForWorkspace) {
      useChatStore.getState().setActiveConversation(null);
      return;
    }
    if (!activeSlotConversationId) return;
    const chat = useChatStore.getState();
    const conv = useConversationsStore.getState();
    if (
      chat.conversationId === activeSlotConversationId &&
      conv.hydratedIds.has(activeSlotConversationId)
    ) {
      return;
    }
    void selectConversation(activeSlotConversationId);
  }, [
    activeMapHydrated,
    activeWorkspaceId,
    conversationsList,
    slotIsValidForWorkspace,
    activeSlotConversationId,
    selectConversation
  ]);

  // Background TTL-respecting model discovery, once per provider per boot.
  // Depends only on enabled provider ids — not `lastDiscoveredAt` mutations.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const id of enabledProviderIds) {
        if (cancelled) return;
        try {
          await discoverCached(id);
        } catch {
          // Failures are surfaced inside the provider card; don't block boot.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabledProviderIds, discoverCached]);

  const openSettings = (tab?: SettingsTabId) => {
    openSecondarySettings(tab);
  };

  const pickWorkspace = useWorkspaceStore((s) => s.pick);
  const setWorkspace = useWorkspaceStore((s) => s.set);

  const onSubmitWorkspacePath = async (raw: string) => {
    const path = raw.trim();
    if (path.length === 0) return;
    try {
      await setWorkspace(path);
      setWorkspacePathOpen(false);
      setWorkspacePathError(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('workspace set by path failed', { path, err: msg });
      setWorkspacePathError(msg);
    }
  };

  const openContextInspector = () => {
    if (!openContextInspectorForActiveChat()) {
      useToastStore
        .getState()
        .show('Open a chat or start a run to inspect context.', 'info');
    }
  };

  // File menu actions are wired here (the only place that knows the
  // settings modal opener) and threaded down into the title bar.
  const fileActions = {
    newConversation: () => newConversation(),
    openWorkspace: () => void pickWorkspace(),
    setWorkspacePath: () => {
      setWorkspacePathError(null);
      setWorkspacePathOpen(true);
    },
    openSettings: () => openSettings(),
    openCheckpoints: () => openSecondaryCheckpoints(),
    openContextInspector,
    quit: () => void vyotiq.window.close()
  };

  const viewActions = {
    openContextInspector
  };

  // Bind window-level accelerators that match the labels in
  // `FileMenu` and `ViewMenu`. Without this hook the menu's `Ctrl+N`
  // / `Ctrl+O` / `Ctrl+,` / `Ctrl+R` / `Ctrl+Shift+I` hints would be
  // decorative-only — Electron's built-in defaults cover Reload /
  // DevTools in development but vanish in packaged builds where the
  // menu role isn't `'reload'` / `'toggleDevTools'`. The reload /
  // devtools handlers go through the same `vyotiq.window.*` IPC the
  // `MenuItem` row does, so menu click and keyboard shortcut share
  // one wire path.
  useGlobalShortcuts({
    newConversation: fileActions.newConversation,
    openWorkspace: fileActions.openWorkspace,
    openSettings: fileActions.openSettings,
    openCheckpoints: fileActions.openCheckpoints,
    openContextInspector: fileActions.openContextInspector,
    reload: () => void vyotiq.window.reload(),
    toggleDevTools: () => void vyotiq.window.toggleDevTools()
  });

  return (
    <div className="flex h-full flex-col bg-surface-base">
      <TitleBar
        fileActions={fileActions}
        viewActions={viewActions}
        onOpenSettings={() => openSettings()}
      />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <LeftDock onOpenSettings={() => openSettings()} />
          <main
            className="min-h-0 flex-1 overflow-hidden bg-surface-base"
            inert={overlayOpen || dockExpanded ? true : undefined}
            aria-hidden={overlayOpen || dockExpanded ? true : undefined}
          >
            <ChatPage
              onOpenProviders={() => openSettings('providers')}
              onOpenCheckpointSettings={() => openSettings('checkpoints')}
            />
          </main>
          <SecondaryZone />
        </div>
      </div>
      {overlayOpen &&
        createPortal(
          <button
            type="button"
            className="fixed inset-0 z-(--z-overlay-backdrop) bg-black/40"
            aria-label="Close panel"
            onClick={closeAllOverlays}
          />,
          document.body
        )}
      <AttachmentPreviewPanel
        open={previewAttachment !== null}
        attachment={previewAttachment}
        onClose={closePreview}
        initialWidth={attachmentPreviewWidth.initialWidth}
        onWidthChange={attachmentPreviewWidth.onWidthChange}
      />
      <LiveDiffFloatingPanel
        target={liveDiffTarget}
        onClose={() => {
          if (liveDiffTarget) dismissLiveDiff(liveDiffTarget.callId);
        }}
      />
      <Suspense fallback={<LoadingHint className="py-4" />}>
        <PromptDialog
          open={workspacePathOpen}
          variant="workspacePath"
          title="Set Workspace by Path"
          message={
            workspacePathError
              ? `Could not set that workspace: ${workspacePathError}\n\nChoose another folder, pick a recent path, or paste an absolute path.`
              : 'Choose a folder or paste an absolute path. Agent V\'s tools will be sandboxed inside it.'
          }
          placeholder={
            navigator.userAgent.toLowerCase().includes('windows')
              ? 'C:\\Users\\you\\project'
              : '/Users/you/project'
          }
          confirmLabel="Set workspace"
          validate={(v) => (v.length === 0 ? 'Path cannot be empty.' : null)}
          onSubmit={(v) => void onSubmitWorkspacePath(v)}
          onCancel={() => {
            setWorkspacePathOpen(false);
            setWorkspacePathError(null);
          }}
        />
      </Suspense>
      <Suspense fallback={<LoadingHint className="py-4" />}>
        <ConfirmHost />
      </Suspense>
      <ToastHost />
    </div>
  );
}
