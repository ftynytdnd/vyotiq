/**
 * Frameless main window factory. Pure function — no side effects beyond
 * creating the window. Title bar is implemented in the renderer.
 */

import { BrowserWindow, shell } from 'electron';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { APP_NAME, IPC } from '@shared/constants.js';
import { safeWebContentsSend } from './safeWebContentsSend.js';
import { setMainWindow } from './getMainWindow.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function createMainWindow(): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    title: APP_NAME,
    width: 1280,
    height: 820,
    minWidth: 880,
    minHeight: 560,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#18181A',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Audit fix 2026-01-P1-1: enable Chromium's process sandbox.
      // The preload only imports `contextBridge` + `ipcRenderer` (both
      // sandbox-compatible) and the renderer talks to main exclusively
      // through `invoke` / typed events — no preload code path needs raw
      // Node access. Flipping this to `true` confines a renderer-side
      // exploit (e.g. via react-markdown / rehype-highlight) to a
      // stripped-down OS sandbox instead of inheriting the main-process
      // privilege of the Electron child. Defense-in-depth for the
      // always-on agent that streams remote model output and renders
      // untrusted markdown.
      sandbox: true
    }
  });

  setMainWindow(win);
  win.once('ready-to-show', () => win.show());

  // Forward window state changes to the renderer so the title bar can update.
  // Audit fix 2026-01-P2-2 + audit P3-3: routes through the shared
  // `safeWebContentsSend` helper so the destroyed-window guard +
  // try/catch live in one place. Electron occasionally fires a
  // `maximize` event during teardown; without the guard the
  // synchronous send throws against a destroyed webContents. We do
  // not detach the listeners explicitly because `BrowserWindow#close`
  // runs `removeAllListeners` automatically once the native handle
  // is gone. We DO check `win.isDestroyed()` before calling
  // `win.isMaximized()` (which would throw on a destroyed handle) —
  // the helper guards the send itself but `isMaximized()` is the
  // caller's responsibility to gate.
  const sendState = () => {
    if (win.isDestroyed()) return;
    safeWebContentsSend(IPC.WINDOW_STATE_CHANGED, {
      isMaximized: win.isMaximized()
    });
  };
  win.on('maximize', sendState);
  win.on('unmaximize', sendState);

  // Open external links in the OS browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Load renderer
  if (process.env['ELECTRON_RENDERER_URL']) {
    await win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    await win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
}
