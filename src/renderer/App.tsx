import { useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { TitleBar } from './components/titlebar/TitleBar.js';
import { LeftDock } from './components/dock/index.js';
import { dockMainPaddingLeft, beginNewChatFromDock } from './components/dock/dockShared.js';
import { WorkbenchShell } from './components/workbench/WorkbenchShell.js';
import {
  closeActiveWorkbenchFocus,
  cycleWorkbenchFocus,
  focusWorkbenchTab,
  workbenchIsActive
} from './components/workbench/workbenchShared.js';
import { ChatPage } from './pages/ChatPage.js';
import { SettingsFullView } from './components/settings/SettingsFullView.js';
import { ToastHost } from './components/toast/ToastHost.js';
import { VectorReindexModal } from './components/settings/VectorReindexModal.js';
import { ElevatedWorkspaceLauncher } from './components/workspace/ElevatedWorkspaceLauncher.js';
import { openWorkspaceLauncher } from './store/useWorkspaceLauncherStore.js';
import {
  selectEnabledProviderIds,
  useProviderStore
} from './store/useProviderStore.js';
import { useProviderAccountStore } from './store/useProviderAccountStore.js';
import { useWorkspaceStore } from './store/useWorkspaceStore.js';
import { useSettingsStore, selectSettingsReady } from './store/useSettingsStore.js';
import { useToastStore } from './store/useToastStore.js';
import {
  useConversationsStore
} from './store/useConversationsStore.js';
import { useUiStore } from './store/useUiStore.js';
import { useDockSchedulesStore } from './store/useDockSchedulesStore.js';
import { useWorkbenchPanelsStore } from './store/useWorkbenchPanelsStore.js';
import { useSourceControlStore } from './store/useSourceControlStore.js';
import { useTimelineUiStore } from './store/useTimelineUiStore.js';
import { useAppViewStore, type SettingsSectionId } from './store/useAppViewStore.js';
import { vyotiq } from './lib/ipc.js';
import { persistSettingsPatch } from './lib/persistSettingsPatch.js';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts.js';
import { useGitHubGitProgress } from './hooks/useGitHubGitProgress.js';
import { useCaptureFrameBridge } from './hooks/useCaptureFrameBridge.js';
import { useDockEditorTreeSync } from './hooks/useDockEditorTreeSync.js';
import {
  applyAppTheme,
  stopWatchSystemTheme,
  themePrefsFromSettings,
  watchSystemTheme
} from './lib/theme.js';
import { useTerminalStore } from './store/useTerminalStore.js';
import { useBrowserStore } from './store/useBrowserStore.js';
import { selectEditorDirty, useEditorStore } from './store/useEditorStore.js';
import { useRestoreEditorTabs } from './hooks/useRestoreEditorTabs.js';
import { resolveKeybindings, isMacPlatform } from './lib/resolveKeybindings.js';
import { eventMatchesCombo } from '@shared/keybindings/defaultKeybindings.js';
import { focusComposer } from './lib/focusComposer.js';
import { registerEscapeLayer } from './lib/escapeLayerStack.js';

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
  const activeWorkspacePath = useWorkspaceStore((s) => s.info.path ?? '');
  const {
    hydrateActiveByWorkspace,
    list: conversationsList,
    activeIdByWorkspace,
    prewarm: prewarmConversation,
    conversationsLoading
  } = useConversationsStore(
    useShallow((s) => ({
      hydrateActiveByWorkspace: s.hydrateActiveByWorkspace,
      list: s.list,
      activeIdByWorkspace: s.activeIdByWorkspace,
      prewarm: s.prewarm,
      conversationsLoading: s.loading
    }))
  );
  const [activeMapHydrated, setActiveMapHydrated] = useState(false);

  const { appView, settingsSection, openSettings, toggleSettings, closeSettings } =
    useAppViewStore(
      useShallow((s) => ({
        appView: s.view,
        settingsSection: s.settingsSection,
        openSettings: s.openSettings,
        toggleSettings: s.toggleSettings,
        closeSettings: s.closeSettings
      }))
    );
  const toggleTerminal = useTerminalStore((s) => s.toggle);
  const settingsOpen = appView === 'settings';
  const dockExpanded = useUiStore((s) => s.dockExpanded);
  const dockWidth = useUiStore((s) => s.dockWidth);
  const mainPaddingLeft = dockMainPaddingLeft(
    dockExpanded && !settingsOpen,
    dockWidth
  );
  useRestoreEditorTabs();
  const showToast = useToastStore((s) => s.show);
  const updateCheckDone = useRef(false);

  // Foundational data: providers, workspace, settings, conversations.
  useEffect(() => {
    void refreshProviders();
    void refreshWorkspace();
    void refreshSettings();
    void refreshConversations();
  }, [refreshProviders, refreshWorkspace, refreshSettings, refreshConversations]);

  // Hydrate UI prefs (left dock expand state + per-workspace collapse
  // state) from persisted settings exactly once, after the settings
  // refresh has resolved. Subsequent toggles self-persist via the ui
  // store.
  useEffect(() => {
    if (!settingsReady || uiHydrated) return;
    const collapsed = settings.ui?.collapsedWorkspaces;
    const filesExpanded = settings.ui?.filesExpandedWorkspaces;
    const dockExpanded =
      settings.ui?.dockExpanded ??
      (settings.ui?.sidebarOpen !== undefined ? settings.ui.sidebarOpen : false);
    hydrateUi({
      dockExpanded,
      dockWidth: settings.ui?.dockWidth,
      workbenchPaneWidth: settings.ui?.workbenchPaneWidth,
      collapsedWorkspaces: collapsed,
      filesExpandedWorkspaces: filesExpanded
    });
    if (
      settings.ui?.sidebarOpen !== undefined &&
      settings.ui?.dockExpanded === undefined
    ) {
      void persistSettingsPatch({ ui: { dockExpanded } });
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
      openSettings('appearance');
      void persistSettingsPatch({
        ui: { firstLaunch: false, lastSettingsTab: 'appearance' }
      });
    }
  }, [settings, settingsReady, openSettings]);

  // Auto-check for updates once after settings hydrate (packaged builds only).
  useEffect(() => {
    if (!settingsReady || updateCheckDone.current) return;
    updateCheckDone.current = true;
    let cancelled = false;
    const unsub = vyotiq.app.onUpdateStatus((status) => {
      if (cancelled || status.phase !== 'downloaded') return;
      showToast(
        status.version ? `Update v${status.version} ready — install from Settings → About` : 'Update ready to install',
        'success'
      );
    });
    return () => {
      cancelled = true;
      unsub();
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
    if (conversationsLoading) return;
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
    conversationsLoading,
    activeIdByWorkspace,
    activeWorkspaceId,
    conversationsList,
    prewarmConversation
  ]);

  // Restore the active workspace session once persisted slots + catalogue
  // are ready (persisted slot, else newest chat; clear stale slots).
  useEffect(() => {
    if (!activeMapHydrated || !activeWorkspaceId || conversationsLoading) return;
    void useConversationsStore.getState().restoreWorkspaceSession(activeWorkspaceId);
  }, [
    activeMapHydrated,
    activeWorkspaceId,
    conversationsLoading,
    conversationsList,
    activeIdByWorkspace
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

  // Live provider account snapshots (5s main-process poller + push updates).
  const hydrateAccounts = useProviderAccountStore((s) => s.hydrate);
  const applyAccountMap = useProviderAccountStore((s) => s.applyMap);
  const applyModelsUpdate = useProviderStore((s) => s.applyModelsUpdate);
  const applyDiscoveryPollHint = useProviderStore((s) => s.applyDiscoveryPollHint);
  useEffect(() => {
    void hydrateAccounts();
    const off = vyotiq.providers.onAccountsUpdated(applyAccountMap);
    return off;
  }, [hydrateAccounts, applyAccountMap]);

  useEffect(() => {
    const offModels = vyotiq.providers.onModelsUpdated(applyModelsUpdate);
    const offHints = vyotiq.providers.onDiscoveryPollHint(applyDiscoveryPollHint);
    return () => {
      offModels();
      offHints();
    };
  }, [applyModelsUpdate, applyDiscoveryPollHint]);

  // Mirror the embedded browser's navigation state into the renderer store.
  useEffect(() => {
    return vyotiq.browser.onState((state) => {
      useBrowserStore.getState().applyState(state);
    });
  }, []);

  const openSettingsSection = (section?: SettingsSectionId | 'providers' | 'memory') => {
    openSettings(section);
  };

  const openWorkspaceLauncherShortcut = () => {
    if (useAppViewStore.getState().view === 'settings') {
      openWorkspaceLauncher('all', 'elevated');
      return;
    }
    useUiStore.getState().setDockExpanded(true);
    openWorkspaceLauncher('all', 'inline');
  };

  const openSetWorkspacePath = () => {
    if (useAppViewStore.getState().view === 'settings') {
      openWorkspaceLauncher('local', 'elevated');
      return;
    }
    useUiStore.getState().setDockExpanded(true);
    openWorkspaceLauncher('local', 'inline');
  };

  // File menu actions are wired here (the only place that knows the
  // settings modal opener) and threaded down into the title bar.
  const fileActions = {
    newConversation: () => {
      void beginNewChatFromDock();
    },
    openWorkspace: () => void openWorkspaceLauncherShortcut(),
    setWorkspacePath: openSetWorkspacePath,
    openSettings: () => toggleSettings(),
    openScheduledRuns: () => {
      useUiStore.getState().setDockExpanded(true);
      useDockSchedulesStore.getState().setOpen(true);
    },
    quit: () => void vyotiq.window.close(),
    chatActionsEnabled: !settingsOpen
  };

  const keybindings = useMemo(
    () => resolveKeybindings(settings.ui?.keybindings, isMacPlatform()),
    [settings.ui?.keybindings]
  );

  // Bind window-level accelerators that match the labels in
  // `FileMenu`. Without this hook the menu's `Ctrl+N`
  // / `Ctrl+O` / `Ctrl+,` / `Ctrl+R` / `Ctrl+Shift+I` hints would be
  // decorative-only — Electron's built-in defaults cover Reload /
  // DevTools in development but vanish in packaged builds where the
  // menu role isn't `'reload'` / `'toggleDevTools'`. The reload /
  // devtools handlers go through the same `vyotiq.window.*` IPC the
  // `MenuItem` row does, so menu click and keyboard shortcut share
  // one wire path.
  useCaptureFrameBridge();
  useGitHubGitProgress();
  useDockEditorTreeSync(activeWorkspaceId, activeWorkspacePath);
  useGlobalShortcuts({
    newConversation: fileActions.newConversation,
    openWorkspace: fileActions.openWorkspace,
    openSettings: () => toggleSettings(),
    toggleTerminal: () => toggleTerminal(activeWorkspaceId),
    blockChatActions: () => useAppViewStore.getState().view === 'settings',
    blockTerminal: () => useAppViewStore.getState().view === 'settings',
    companionPanels: () => useWorkbenchPanelsStore.getState().setOpen(true),
    blockCompanionPanels: () => useAppViewStore.getState().view === 'settings',
    sourceControl: () => {
      if (activeWorkspaceId) useSourceControlStore.getState().toggle(activeWorkspaceId);
    },
    blockSourceControl: () =>
      useAppViewStore.getState().view === 'settings' || !activeWorkspaceId,
    saveEditor: () => {
      const editor = useEditorStore.getState();
      if (!editor.open || !editor.activeFilePath || !selectEditorDirty(editor)) return;
      void editor.save();
    },
    blockSaveEditor: () => useAppViewStore.getState().view === 'settings',
    focusComposer: () => {
      focusComposer();
    },
    blockFocusComposer: () => useAppViewStore.getState().view === 'settings',
    blockWorkbenchTab: () =>
      useAppViewStore.getState().view === 'settings' || !workbenchIsActive(),
    closeWorkbenchTab: () => closeActiveWorkbenchFocus(),
    cycleWorkbenchTabPrev: () => cycleWorkbenchFocus('prev'),
    cycleWorkbenchTabNext: () => cycleWorkbenchFocus('next'),
    reload: () => void vyotiq.window.reload(),
    toggleDevTools: () => void vyotiq.window.toggleDevTools()
  }, keybindings);

  const closeSettingsBinding = keybindings.closeSettings;
  const closeSettingsIsEscapeOnly = closeSettingsBinding === 'Escape';

  useEffect(() => {
    if (!settingsOpen || !closeSettingsIsEscapeOnly) return;
    return registerEscapeLayer('settings-close', 50, () => {
      const target = document.activeElement;
      if (
        target instanceof HTMLElement &&
        (target.closest('[role="dialog"]') || target.closest('[data-escape-dismiss="false"]'))
      ) {
        return false;
      }
      closeSettings();
      return true;
    });
  }, [settingsOpen, closeSettings, closeSettingsIsEscapeOnly]);

  useEffect(() => {
    if (!settingsOpen || closeSettingsIsEscapeOnly) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (!eventMatchesCombo(e, keybindings.closeSettings)) return;
      const target = e.target;
      if (
        target instanceof HTMLElement &&
        (target.closest('[role="dialog"]') || target.closest('[data-escape-dismiss="false"]'))
      ) {
        return;
      }
      e.preventDefault();
      closeSettings();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [settingsOpen, closeSettings, closeSettingsIsEscapeOnly, keybindings.closeSettings]);

  return (
    <div className="relative flex h-full flex-col bg-surface-base">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <LeftDock
          settingsMode={settingsOpen}
          onSetWorkspacePath={openSetWorkspacePath}
        />
        <TitleBar
          fileActions={fileActions}
          onBackFromSettings={closeSettings}
        />
        <main
          className="relative z-0 flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-surface-base"
          style={{
            paddingTop: 'var(--titlebar-h)',
            paddingLeft: mainPaddingLeft,
            transition: 'padding-left 200ms ease-out'
          }}
        >
          <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
            {settingsOpen ? (
              <SettingsFullView />
            ) : (
              <WorkbenchShell>
                <ChatPage onOpenProviders={() => openSettingsSection('providers')} />
              </WorkbenchShell>
            )}
          </div>
        </main>
      </div>
      <ElevatedWorkspaceLauncher />
      <ToastHost />
      <VectorReindexModal />
    </div>
  );
}
