/**
 * Frameless main window factory. Pure function — no side effects beyond
 * creating the window. Title bar is implemented in the renderer.
 */

import { BrowserWindow, shell } from 'electron';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { APP_NAME, IPC } from '@shared/constants.js';

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
      sandbox: false
    }
  });

  win.once('ready-to-show', () => win.show());

  // Forward window state changes to the renderer so the title bar can update.
  const sendState = () => {
    win.webContents.send(IPC.WINDOW_STATE_CHANGED, {
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
