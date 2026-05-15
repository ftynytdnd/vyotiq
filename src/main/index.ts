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
import { registerIpc } from './ipc/registerIpc.js';
import { logger, installCrashHandlers } from './logging/logger.js';
import { flushAll as flushConversations } from './conversations/conversationStore.js';
import { flushAll as flushCheckpoints } from './checkpoints/index.js';
import { flushWorkspaceState } from './workspace/workspaceState.js';
import { clearAllPending as drainPendingConfirms } from './orchestrator/confirmBus.js';

const log = logger.child('boot');

async function bootstrap() {
  installCrashHandlers();
  await app.whenReady();

  registerIpc();
  log.info('app ready; ipc registered');

  await createMainWindow();

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
  drainPendingConfirms();
  if (isShuttingDown) return;
  isShuttingDown = true;
  event.preventDefault();
  Promise.allSettled([
    flushConversations(),
    flushCheckpoints(),
    // Belt-and-suspenders re-write of the workspace registry. Public
    // mutators already persist before flipping the cache, so the
    // happy path is a no-op idempotent write; the explicit flush
    // covers the loadOnce migration window where the on-disk shape
    // could otherwise lag the in-memory snapshot if a crash lands
    // mid-boot. Idempotent + cheap thanks to `updateBlob`'s debounce.
    flushWorkspaceState()
  ])
    .catch((err) => log.error('shutdown flush failed', { err }))
    .finally(() => app.quit());
});

// Harden: never allow opening external windows from links inside the app.
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});

bootstrap().catch((err) => {
  log.error('fatal bootstrap error', { err });
  app.exit(1);
});
