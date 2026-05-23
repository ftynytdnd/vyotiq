import { lazy, Suspense, useEffect, useState } from 'react';
import { TitleBar } from './components/titlebar/TitleBar.js';
import { SecondaryZone } from './components/zone/index.js';
import { ChatPage } from './pages/ChatPage.js';
import { ToastHost } from './components/toast/ToastHost.js';
// Lazy-loaded overlays. ConfirmHost and PromptDialog are the only
// modal surfaces left at the app root — Settings, Checkpoints, and
// Context Inspector live in the right-hand SecondaryZone.
const ConfirmHost = lazy(() =>
  import('./components/confirm/ConfirmHost.js').then((m) => ({ default: m.ConfirmHost }))
);
const PromptDialog = lazy(() =>
  import('./components/ui/PromptDialog.js').then((m) => ({ default: m.PromptDialog }))
);
import { useProviderStore } from './store/useProviderStore.js';
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
import { vyotiq } from './lib/ipc.js';
import { logger } from './lib/logger.js';
import { openContextInspectorForActiveChat } from './lib/openContextInspector.js';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts.js';

const log = logger.child('app');

export default function App() {
  const refreshProviders = useProviderStore((s) => s.refresh);
  const refreshWorkspace = useWorkspaceStore((s) => s.refresh);
  const refreshSettings = useSettingsStore((s) => s.refresh);
  const refreshConversations = useConversationsStore((s) => s.refresh);
  const providers = useProviderStore((s) => s.providers);
  const discoverCached = useProviderStore((s) => s.discoverCached);
  const settings = useSettingsStore((s) => s.settings);
  const settingsReady = useSettingsStore(selectSettingsReady);
  const hydrateUi = useUiStore((s) => s.hydrate);
  const uiHydrated = useUiStore((s) => s.hydrated);
  const hydrateTimelineUi = useTimelineUiStore((s) => s.hydrate);
  const timelineUiHydrated = useTimelineUiStore((s) => s.hydrated);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeId);
  const hydrateActiveByWorkspace = useConversationsStore((s) => s.hydrateActiveByWorkspace);
  const selectConversation = useConversationsStore((s) => s.select);
  const conversationsList = useConversationsStore((s) => s.list);
  const activeIdByWorkspace = useConversationsStore((s) => s.activeIdByWorkspace);
  const [activeMapHydrated, setActiveMapHydrated] = useState(false);

  const [workspacePathOpen, setWorkspacePathOpen] = useState(false);
  const [workspacePathError, setWorkspacePathError] = useState<string | null>(null);
  const initCheckpoints = useCheckpointsStore((s) => s.initOnce);
  const openSecondarySettings = useSecondaryZoneStore((s) => s.openSettings);
  const openSecondaryCheckpoints = useSecondaryZoneStore((s) => s.openCheckpoints);

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

  // Hydrate UI prefs (bottom dock expand state + per-workspace collapse
  // state) from persisted settings exactly once, after the settings
  // refresh has resolved. Subsequent toggles self-persist via the ui
  // store.
  useEffect(() => {
    if (!settingsReady || uiHydrated) return;
    const collapsed = settings.ui?.collapsedWorkspaces;
    const dockExpanded =
      settings.ui?.dockExpanded ??
      (settings.ui?.sidebarOpen !== undefined ? settings.ui.sidebarOpen : false);
    hydrateUi({ dockExpanded, collapsedWorkspaces: collapsed });
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
  const prewarmConversation = useConversationsStore((s) => s.prewarm);
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

  // Sync the chat store's active mirror with the active workspace's
  // last-viewed conversation. Runs whenever:
  //   - the active workspace changes (user clicks another group),
  //   - the persisted active map finishes hydrating (first boot), or
  //   - the conversations list arrives (so we can validate the slot
  //     still exists before selecting it).
  useEffect(() => {
    if (!activeMapHydrated) return;
    if (!activeWorkspaceId) return;
    const targetId = activeIdByWorkspace[activeWorkspaceId] ?? null;
    // Verify the slot still resolves against the FULL list — the user
    // could have deleted the conversation in a previous boot that
    // didn't run this hydration step. If not (or no slot at all),
    // explicitly clear the chat mirror so the user gets a fresh-state
    // ChatPage instead of seeing the previous workspace's session.
    const slotIsValid =
      targetId !== null &&
      conversationsList.some((m) => m.id === targetId && m.workspaceId === activeWorkspaceId);
    if (slotIsValid) {
      void selectConversation(targetId!);
      return;
    }
    // No valid slot — make sure the mirror isn't still showing a
    // sibling workspace's slice. `setActiveConversation(null)` only
    // touches the mirror, never the slice registry, so background
    // runs keep streaming undisturbed.
    useChatStore.getState().setActiveConversation(null);
  }, [
    activeMapHydrated,
    activeWorkspaceId,
    activeIdByWorkspace,
    conversationsList,
    selectConversation
  ]);

  // Background TTL-respecting model discovery, once per provider per boot.
  // Skipped for providers that already have a fresh cache server-side.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const p of providers) {
        if (cancelled) return;
        if (!p.enabled) continue;
        try {
          await discoverCached(p.id);
        } catch {
          // Failures are surfaced inside the provider card; don't block boot.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Audit fix L-02: depend on the joined provider-id+enabled-flag
    // string so REPLACING a provider (same length, different id) still
    // triggers discovery against the new endpoint. The server's TTL
    // cache deduplicates anyway — re-running on every change is safe
    // and ensures cache misses on the new id are caught immediately
    // rather than waiting for the TTL to expire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providers.map((p) => `${p.id}:${p.enabled ? 1 : 0}`).join(',')]);

  const openSettings = (tab?: SettingsTabId) => {
    openSecondarySettings(tab);
  };

  const newConversation = useConversationsStore((s) => s.newConversation);
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
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <main className="min-h-0 flex-1 overflow-hidden bg-surface-base">
            <ChatPage
              onOpenProviders={() => openSettings('providers')}
              onOpenCheckpointSettings={() => openSettings('checkpoints')}
            />
          </main>
        </div>
        <SecondaryZone />
      </div>
      <Suspense fallback={null}>
        <PromptDialog
          open={workspacePathOpen}
          title="Set Workspace by Path"
          message={
            workspacePathError
              ? `Could not set that workspace: ${workspacePathError}\n\nPaste another absolute path or cancel.`
              : 'Paste an absolute path to a folder. Agent V\'s tools will be sandboxed inside it.'
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
      <Suspense fallback={null}>
        <ConfirmHost />
      </Suspense>
      <ToastHost />
    </div>
  );
}
