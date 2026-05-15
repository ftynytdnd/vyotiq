import { lazy, Suspense, useEffect, useState } from 'react';
import { TitleBar } from './components/titlebar/TitleBar.js';
import { Sidebar } from './components/sidebar/Sidebar.js';
import { EdgeHandle } from './components/sidebar/EdgeHandle.js';
import { ChatPage } from './pages/ChatPage.js';
import { ToastHost } from './components/toast/ToastHost.js';
// Lazy-loaded panels. None of these are needed for first paint:
//   - `SettingsModal` only mounts when the user invokes File → Settings
//     (or the configure-provider empty state), and it carries the
//     entire memory + providers + permissions surface (largest single
//     subtree in the renderer).
//   - `ConfirmHost` only mounts when a tool requests confirmation.
//   - `PromptDialog` only mounts on the rare File → Set workspace by
//     path flow.
// Splitting these out drops ~hundreds of KB from the eager bundle and
// silences the vite single-chunk warning (1.69 MB → smaller initial +
// async chunks). Each Suspense boundary uses a `null` fallback so the
// surrounding tree never visibly reflows; the panels themselves
// already carry their own open/closed gating logic, so an in-flight
// chunk fetch with `open=false` simply renders nothing.
const SettingsModal = lazy(() =>
  import('./components/settings/SettingsModal.js').then((m) => ({ default: m.SettingsModal }))
);
const ConfirmHost = lazy(() =>
  import('./components/confirm/ConfirmHost.js').then((m) => ({ default: m.ConfirmHost }))
);
const PromptDialog = lazy(() =>
  import('./components/ui/PromptDialog.js').then((m) => ({ default: m.PromptDialog }))
);
const CheckpointsView = lazy(() =>
  import('./components/checkpoints/CheckpointsView.js').then((m) => ({
    default: m.CheckpointsView
  }))
);
import { useProviderStore } from './store/useProviderStore.js';
import { useWorkspaceStore } from './store/useWorkspaceStore.js';
import { useSettingsStore } from './store/useSettingsStore.js';
import { useConversationsStore } from './store/useConversationsStore.js';
import { useChatStore } from './store/useChatStore.js';
import { useUiStore } from './store/useUiStore.js';
import { useTimelineUiStore } from './store/useTimelineUiStore.js';
import { useCheckpointsStore } from './store/useCheckpointsStore.js';
import { vyotiq } from './lib/ipc.js';
import { cn } from './lib/cn.js';
import { logger } from './lib/logger.js';
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

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'providers' | 'permissions' | 'performance' | 'checkpoints' | 'memory' | 'about'>('providers');
  const [workspacePathOpen, setWorkspacePathOpen] = useState(false);
  const [workspacePathError, setWorkspacePathError] = useState<string | null>(null);
  const [checkpointsOpen, setCheckpointsOpen] = useState(false);
  const initCheckpoints = useCheckpointsStore((s) => s.initOnce);

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

  // Hydrate UI prefs (sidebar open/closed + per-workspace collapse
  // state) from persisted settings exactly once, after the settings
  // refresh has resolved. Subsequent toggles self-persist via the ui
  // store.
  useEffect(() => {
    if (uiHydrated) return;
    const persisted = settings.ui?.sidebarOpen;
    const collapsed = settings.ui?.collapsedWorkspaces;
    if (typeof persisted === 'boolean') {
      hydrateUi({ sidebarOpen: persisted, collapsedWorkspaces: collapsed });
    } else if (settings.permissions !== undefined) {
      // Settings have loaded but no ui.sidebarOpen field exists yet — mark
      // hydrated so future toggles persist. Default to open.
      hydrateUi({ sidebarOpen: true, collapsedWorkspaces: collapsed });
    }
  }, [settings, uiHydrated, hydrateUi]);

  // Hydrate persisted timeline expand/collapse state exactly once after
  // the first settings refresh resolves. Cheap — just a
  // Record<string, string[]> snapshot.
  useEffect(() => {
    if (timelineUiHydrated) return;
    if (settings.permissions === undefined) return; // still loading
    hydrateTimelineUi(settings.ui?.expandedRows);
  }, [settings, timelineUiHydrated, hydrateTimelineUi]);

  // Hydrate the per-workspace last-active conversation map from
  // persisted settings exactly once after the first settings refresh
  // resolves. Subsequent edits self-persist via
  // `useConversationsStore.persistActiveMap`.
  useEffect(() => {
    if (activeMapHydrated) return;
    if (settings.permissions === undefined) return; // still loading
    hydrateActiveByWorkspace(settings.ui?.activeConversationByWorkspace ?? {});
    setActiveMapHydrated(true);
  }, [settings, activeMapHydrated, hydrateActiveByWorkspace]);

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
    // We only want this to run on the first non-empty providers list. The
    // server cache deduplicates further calls, so re-running on every change
    // would be wasteful but safe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providers.length]);

  const openSettings = (tab: typeof settingsTab = 'providers') => {
    setSettingsTab(tab);
    setSettingsOpen(true);
  };

  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
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

  // File menu actions are wired here (the only place that knows the
  // settings modal opener) and threaded down into the title bar.
  const fileActions = {
    newConversation: () => newConversation(),
    openWorkspace: () => void pickWorkspace(),
    setWorkspacePath: () => {
      setWorkspacePathError(null);
      setWorkspacePathOpen(true);
    },
    openSettings: () => openSettings('providers'),
    openCheckpoints: () => setCheckpointsOpen(true),
    quit: () => void vyotiq.window.close()
  };

  // Bind window-level accelerators that match the labels in `FileMenu`.
  // Without this hook, the menu's `Ctrl+N` / `Ctrl+O` / `Ctrl+,`
  // hints would be decorative-only.
  useGlobalShortcuts({
    newConversation: fileActions.newConversation,
    openWorkspace: fileActions.openWorkspace,
    openSettings: fileActions.openSettings
  });

  return (
    <div className="flex h-full flex-col bg-surface-base">
      <TitleBar fileActions={fileActions} />
      <div className="relative flex flex-1 overflow-hidden">
        <div
          aria-hidden={!sidebarOpen}
          className={cn(
            'min-w-0 flex-shrink-0 overflow-hidden transition-[width] duration-200 ease-out',
            sidebarOpen ? 'w-[250px]' : 'w-0 pointer-events-none'
          )}
        >
          <Sidebar
            onOpenSettings={() => openSettings('permissions')}
            onOpenCheckpoints={() => setCheckpointsOpen(true)}
          />
        </div>
        <EdgeHandle />
        <main className="min-w-0 flex-1 overflow-hidden bg-surface-base">
          <ChatPage
            onOpenProviders={() => openSettings('providers')}
            onOpenCheckpoints={() => setCheckpointsOpen(true)}
          />
        </main>
      </div>
      <Suspense fallback={null}>
        <SettingsModal
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          initialTab={settingsTab}
        />
      </Suspense>
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
      <Suspense fallback={null}>
        <CheckpointsView open={checkpointsOpen} onClose={() => setCheckpointsOpen(false)} />
      </Suspense>
      <ToastHost />
    </div>
  );
}
