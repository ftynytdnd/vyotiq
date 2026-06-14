/**
 * Vyotiq — Electron main process entry.
 *
 * Responsibilities:
 *   1. Initialize app + lifecycle hooks
 *   2. Create the frameless window
 *   3. Register all IPC handlers
 */

import { app, BrowserWindow } from 'electron';
import { createMainWindow } from './window/createMainWindow.js';
import { isBrowserWebContents } from './window/browserManager.js';
import { migrateUserDataLayout } from './paths/migrateUserDataLayout.js';
import { registerIpc } from './ipc/registerIpc.js';
import { teardownProvidersIpc } from './ipc/providers.ipc.js';
import { teardownTerminalIpc } from './ipc/terminal.ipc.js';
import { teardownBrowserIpc } from './ipc/browser.ipc.js';
import { teardownCompletionIpc } from './ipc/completion.ipc.js';
import { logger, installCrashHandlers } from './logging/logger.js';
import { assertHarnessBoot, warmHarnessOverrides } from './harness/harnessLoader.js';
import { flushAll as flushConversations } from './conversations/conversationStore.js';
import { flushAll as flushCheckpoints } from './checkpoints/index.js';
import { flushWorkspaceState } from './workspace/workspaceState.js';
import { abortRun, listActiveRuns } from './orchestrator/AgentV.js';
import { getSettings } from './settings/settingsStore.js';
import { sweepOrphanAttachments } from './attachments/gc.js';
import { sweepOrphanCompactionAllWorkspaces } from './orchestrator/context/compactionSweep.js';
import { getActiveWorkspace } from './workspace/workspaceState.js';
import {
  disposeAllVectorIndexesAsync,
  scheduleWorkspaceVectorIndex
} from './memory/vector/indexScheduler.js';
import { closeAllVectorDbs } from './memory/vector/vectorDb.js';
import {
  checkForAppUpdates,
  getAppUpdateStatus,
  initAutoUpdaterService,
  teardownAutoUpdaterService
} from './updater/autoUpdaterService.js';
import { IPC } from '@shared/constants.js';
import { safeWebContentsSend } from './window/safeWebContentsSend.js';
import { startScheduledRunsService, stopScheduledRunsService } from './scheduler/scheduledRunsService.js';
const log = logger.child('boot');

// Single-instance lock. Vyotiq is an always-on desktop agent that owns
// several `<userData>/vyotiq/...` files (conversation JSONL transcripts,
// the conversations index, run manifests + checkpoint blob store, the
// global meta-rules markdown, the encrypted settings blob). Each main
// process maintains its OWN in-memory cache + write chain for those
// stores; two processes racing on the same files cannot serialize.
// Real failure modes prevented here: torn `index.json` writes
// overwriting each other's flushes, interleaved JSONL appends from
// concurrent orchestrator runs, conflicting `safeStorage` decrypt /
// encrypt cycles for provider keys, both processes flipping the
// `removedIds` tombstone Map independently, and dangling renderer
// `webContents.send` from the loser process.
//
// Behaviour matches the standard Electron lifecycle pattern: the
// FIRST instance acquires the lock and proceeds to bootstrap; any
// SECOND launch (double-clicking the launcher, AppX side-launch,
// running `npm run dev` while a prior instance is alive, etc.) fails
// the lock and exits immediately. The first instance receives a
// `second-instance` event and focuses its existing window so the
// user's click feels like "the app came to the front" rather than
// silently doing nothing.
//
// CLI args are intentionally NOT forwarded today — the
// `additionalData` slot stays empty. A future feature that wants to
// open a workspace via `vyotiq path/to/workspace` would extend the
// `second-instance` payload here; until then `--no-args` is strict so
// the IPC-validation surface that protects every other channel
// (`wrapIpcHandler`, `validate.ts`) isn't bypassed by a CLI flow.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  log.info('another instance is already running; quitting');
  app.quit();
  // `app.quit` is asynchronous — block further bootstrap synchronously
  // so we don't double-register IPC handlers / window-open guards.
  // `process.exit` is the right call here: the IPC channel on which
  // the "second-instance" event lands has already been wired into
  // Electron's internal main bus by `requestSingleInstanceLock`, so
  // the user's click will reach the first instance regardless of how
  // quickly we exit.
  process.exit(0);
}
app.on('second-instance', () => {
  // A user invoked Vyotiq while a prior instance was already running.
  // Restore + focus the existing window so the click "wakes" the app
  // instead of silently being swallowed. We deliberately ignore the
  // event's `argv` / `workingDirectory` / `additionalData` slots —
  // see the lock-acquisition comment above for the rationale.
  const wins = BrowserWindow.getAllWindows();
  const win = wins.find((w) => !w.isDestroyed());
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

async function bootstrap() {
  installCrashHandlers();
  assertHarnessBoot();
  await app.whenReady();

  await migrateUserDataLayout().catch((err) =>
    log.warn('userData layout migration failed; continuing with current paths', { err })
  );

  registerIpc();
  await warmHarnessOverrides().catch((err) =>
    log.warn('harness override preload failed; using bundled defaults', { err })
  );
  await getSettings().catch((err) => log.warn('settings preload failed; using defaults', { err }));
  const activeWs = await getActiveWorkspace().catch(() => null);
  if (activeWs?.path) scheduleWorkspaceVectorIndex(activeWs.path);
  log.info('app ready; ipc registered');
  startScheduledRunsService();

  await createMainWindow();

  void initAutoUpdaterService().then(() => {
    if (!app.isPackaged) return;
    safeWebContentsSend(IPC.APP_UPDATE_STATUS, getAppUpdateStatus());
    void checkForAppUpdates().catch(() => {
      /* silent on boot — About tab surfaces errors */
    });
  });

  // Attachment GC: conversation-delete hook is always active (see
  // `deleteAttachmentsForConversation`). The orphan sweeper runs once
  // after a 30 s idle delay to reclaim dirs from crashed / partial
  // deletes without impacting boot time.
  const gcTimer = setTimeout(() => {
    sweepOrphanAttachments().catch((err) =>
      log.warn('orphan attachment sweep failed', { err })
    );
    sweepOrphanCompactionAllWorkspaces().catch((err) =>
      log.warn('orphan compaction sweep failed', { err })
    );
  }, 30_000);
  gcTimer.unref();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Flush in-flight conversation index updates on quit. We DO preventDefault
// the first `before-quit` so the async flush actually completes before
// Electron tears down the process — otherwise streaming-text bursts that
// land in the last few hundred milliseconds before close are lost. The
// guard prevents an infinite loop when the post-flush `app.quit()` re-
// enters this handler.
let isShuttingDown = false;
app.on('before-quit', (event) => {
  for (const info of listActiveRuns()) {
    abortRun(info.runId);
  }
  stopScheduledRunsService();
  if (isShuttingDown) return;
  isShuttingDown = true;
  event.preventDefault();
  Promise.allSettled([
    teardownProvidersIpc(),
    flushConversations(),
    flushCheckpoints(),
    flushWorkspaceState(),
    Promise.resolve().then(() => disposeAllVectorIndexesAsync()).then(() => {
      closeAllVectorDbs();
    }),
    Promise.resolve().then(() => teardownTerminalIpc()),
    Promise.resolve().then(() => teardownBrowserIpc()),
    Promise.resolve().then(() => teardownCompletionIpc()),
    Promise.resolve().then(() => teardownAutoUpdaterService())
  ])
    .catch((err) => log.error('shutdown flush failed', { err }))
    .finally(() => app.quit());
});

// Harden: never allow opening external windows from links inside the app,
// AND never allow in-place navigation away from the bundled renderer
// (audit fix 2026-01-P1-2). `setWindowOpenHandler` only intercepts
// `target=_blank` / `window.open` paths; an in-place navigation via
// `window.location = '…'` would replace the loaded `index.html` with a
// remote page that inherits the preload's `contextBridge` surface —
// exposing the entire `window.vyotiq` API to the attacker page. The
// `will-navigate` listener allows ONLY the dev-server URL (when running
// `electron-vite dev`) and the bundled `file://` URL; everything else
// is hard-denied. `will-attach-webview` is a belt-and-suspenders gate
// against future `<webview>` introduction; the renderer doesn't use any
// today.
app.on('web-contents-created', (_event, contents) => {
  // The embedded Globe browser (a WebContentsView) is the ONE surface
  // allowed to navigate freely across the web. It manages its own
  // window-open handler in `browserManager` and runs in a separate
  // sandboxed partition with no Vyotiq preload, so the renderer's
  // `contextBridge` surface is never exposed to remote pages. Every
  // other webContents keeps the strict navigation lockdown below.
  if (isBrowserWebContents(contents.id)) return;
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, url) => {
    if (isBrowserWebContents(contents.id)) return;
    const allowed = process.env['ELECTRON_RENDERER_URL'];
    if (allowed && url.startsWith(allowed)) return;
    if (url.startsWith('file://')) return;
    log.warn('blocked in-place navigation attempt', { url });
    event.preventDefault();
  });
  contents.on('will-attach-webview', (event) => {
    log.warn('blocked <webview> attach attempt');
    event.preventDefault();
  });
});

bootstrap().catch((err) => {
  log.error('fatal bootstrap error', { err });
  app.exit(1);
});
