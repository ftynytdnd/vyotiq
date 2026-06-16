import { useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { TitleBar } from './components/titlebar/TitleBar.js';
import { LeftDock } from './components/dock/index.js';
import { dockMainPaddingLeft, DOCK_STRIP_WIDTH, beginNewChatFromDock } from './components/dock/dockShared.js';
import { WorkbenchShell } from './components/workbench/WorkbenchShell.js';
import { RightWorkbenchRail } from './components/workbench/RightWorkbenchRail.js';
import { WORKBENCH_EDGE_CONTAINER_CLASS } from './components/workbench/workbenchChrome.js';
import {
  closeActiveWorkbenchFocus,
  cycleWorkbenchFocus,
  workbenchIsActive
} from './components/workbench/workbenchShared.js';
import { ChatPage } from './pages/ChatPage.js';
import { SettingsFullView } from './components/settings/SettingsFullView.js';
import { ToastHost } from './components/toast/ToastHost.js';
import { VectorReindexModal } from './components/settings/VectorReindexModal.js';
import { PromptDialog } from './components/ui/PromptDialog.js';
import {
  selectEnabledProviderIds,
  useProviderStore
} from './store/useProviderStore.js';
import { useProviderAccountStore } from './store/useProviderAccountStore.js';
import { useWorkspaceStore } from './store/useWorkspaceStore.js';
import { useSettingsStore, selectSettingsReady } from './store/useSettingsStore.js';
import { useToastStore } from './store/useToastStore.js';
import { useConversationsStore } from './store/useConversationsStore.js';
import { useChatStore } from './store/useChatStore.js';
import { useUiStore } from './store/useUiStore.js';
import { useTimelineUiStore } from './store/useTimelineUiStore.js';
import { useAppViewStore, type SettingsSectionId } from './store/useAppViewStore.js';
import { vyotiq } from './lib/ipc.js';
import { logger } from './lib/logger.js';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts.js';
import {
  applyAppTheme,
  stopWatchSystemTheme,
  themePrefsFromSettings,
  watchSystemTheme
} from './lib/theme.js';
import { useTerminalStore } from './store/useTerminalStore.js';
import { useBrowserStore } from './store/useBrowserStore.js';
import { selectEditorDirty, useEditorStore } from './store/useEditorStore.js';
import { useEditorAgentSync } from './hooks/useEditorAgentSync.js';
import { useRestoreEditorTabs } from './hooks/useRestoreEditorTabs.js';
import { resolveKeybindings, isMacPlatform } from './lib/resolveKeybindings.js';
import { eventMatchesCombo } from '@shared/keybindings/defaultKeybindings.js';

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
    prewarm: prewarmConversation
  } = useConversationsStore(
    useShallow((s) => ({
      hydrateActiveByWorkspace: s.hydrateActiveByWorkspace,
      select: s.select,
      list: s.list,
      activeIdByWorkspace: s.activeIdByWorkspace,
      prewarm: s.prewarm
    }))
  );
  const [activeMapHydrated, setActiveMapHydrated] = useState(false);

  const [workspacePathOpen, setWorkspacePathOpen] = useState(false);
  const [workspacePathError, setWorkspacePathError] = useState<string | null>(null);
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
  useEditorAgentSync();
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
    const dockExpanded =
      settings.ui?.dockExpanded ??
      (settings.ui?.sidebarOpen !== undefined ? settings.ui.sidebarOpen : false);
    hydrateUi({
      dockExpanded,
      dockWidth: settings.ui?.dockWidth,
      workbenchPaneWidth: settings.ui?.workbenchPaneWidth,
      collapsedWorkspaces: collapsed
    });
    if (
      settings.ui?.sidebarOpen !== undefined &&
      settings.ui?.dockExpanded === undefined
    ) {
      void vyotiq.settings.set({ ui: { dockExpanded } });
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
      void vyotiq.settings.set({
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

  // Follow the persisted last-active slot for the active workspace once
  // settings + the conversation catalogue are ready. Skip when the mirror
  // already shows that hydrated conversation — avoids redundant
  // `select()` supersede churn from duplicate boot-time effects.
  useEffect(() => {
    if (!activeMapHydrated || !activeWorkspaceId) return;
    if (conversationsList.length === 0) return;
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
    conversationsList,
    activeSlotConversationId,
    slotIsValidForWorkspace,
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

  // Reap closed/exited PTY sessions from the terminal store.
  useEffect(() => {
    return vyotiq.terminal.onExit((event) => {
      useTerminalStore.getState().handleExit(event.sessionId);
    });
  }, []);

  const openSettingsSection = (section?: SettingsSectionId | 'providers' | 'memory') => {
    openSettings(section);
  };

  const pickWorkspace = useWorkspaceStore((s) => s.pick);
  const setWorkspace = useWorkspaceStore((s) => s.set);

  const openSetWorkspacePath = () => {
    setWorkspacePathError(null);
    setWorkspacePathOpen(true);
  };

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

  // File menu actions are wired here (the only place that knows the
  // settings modal opener) and threaded down into the title bar.
  const fileActions = {
    newConversation: () => {
      void beginNewChatFromDock();
    },
    openWorkspace: () => void pickWorkspace(),
    setWorkspacePath: openSetWorkspacePath,
    openSettings: () => toggleSettings(),
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
  useGlobalShortcuts({
    newConversation: fileActions.newConversation,
    openWorkspace: fileActions.openWorkspace,
    openSettings: () => toggleSettings(),
    toggleTerminal: () => toggleTerminal(activeWorkspaceId),
    blockChatActions: () => useAppViewStore.getState().view === 'settings',
    blockTerminal: () => useAppViewStore.getState().view === 'settings',
    saveEditor: () => {
      const editor = useEditorStore.getState();
      if (!editor.open || !editor.activeFilePath || !selectEditorDirty(editor)) return;
      void editor.save();
    },
    blockSaveEditor: () => useAppViewStore.getState().view === 'settings',
    blockWorkbenchTab: () =>
      useAppViewStore.getState().view === 'settings' || !workbenchIsActive(),
    closeWorkbenchTab: () => closeActiveWorkbenchFocus(),
    cycleWorkbenchTabPrev: () => cycleWorkbenchFocus('prev'),
    cycleWorkbenchTabNext: () => cycleWorkbenchFocus('next'),
    reload: () => void vyotiq.window.reload(),
    toggleDevTools: () => void vyotiq.window.toggleDevTools()
  }, keybindings);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (!settingsOpen) return;
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
  }, [settingsOpen, closeSettings, keybindings]);

  return (
    <div className="relative flex h-full flex-col bg-surface-base">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <LeftDock
          settingsMode={settingsOpen}
          onBackFromSettings={closeSettings}
          onOpenSettings={() => openSettingsSection()}
          onOpenWorkspace={() => void pickWorkspace()}
          onSetWorkspacePath={openSetWorkspacePath}
        />
        <TitleBar fileActions={fileActions} />
        {!settingsOpen ? (
          <div className={WORKBENCH_EDGE_CONTAINER_CLASS}>
            <RightWorkbenchRail />
          </div>
        ) : null}
        <main
          className="relative z-0 flex h-full min-h-0 w-full flex-col overflow-hidden bg-surface-base"
          style={{
            paddingTop: 'var(--titlebar-h)',
            paddingLeft: mainPaddingLeft,
            paddingRight: settingsOpen ? 0 : DOCK_STRIP_WIDTH,
            transition: 'padding-left 200ms ease-out'
          }}
        >
          <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
            {settingsOpen ? (
              <SettingsFullView initialSection={settingsSection} />
            ) : (
              <WorkbenchShell>
                <ChatPage onOpenProviders={() => openSettingsSection('providers')} />
              </WorkbenchShell>
            )}
          </div>
        </main>
      </div>
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
      <ToastHost />
      <VectorReindexModal />
    </div>
  );
}
