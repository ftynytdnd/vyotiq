/**
 * Global singleton BrowserWindow for in-app HTML report viewing.
 */

import { BrowserWindow, shell } from 'electron';
import { basename } from 'node:path';
import { readFile } from 'node:fs/promises';
import { getMainWindow } from './getMainWindow.js';
import { logger } from '../logging/logger.js';

const log = logger.child('window/reportBrowser');

const DEFAULT_WIDTH = 960;
const DEFAULT_HEIGHT = 720;

let reportWindow: BrowserWindow | null = null;
let loadedAbsPath: string | null = null;

function centerOnParent(win: BrowserWindow, parent: BrowserWindow | null): void {
  if (!parent || parent.isDestroyed()) {
    win.center();
    return;
  }
  const pb = parent.getBounds();
  const wb = win.getBounds();
  win.setPosition(
    Math.round(pb.x + (pb.width - wb.width) / 2),
    Math.round(pb.y + (pb.height - wb.height) / 2)
  );
}

async function extractTitleFromHtml(absPath: string): Promise<string | null> {
  try {
    const head = (await readFile(absPath, 'utf8')).slice(0, 4096);
    const match = head.match(/<title[^>]*>([^<]*)<\/title>/i);
    return match?.[1]?.trim() || null;
  } catch {
    return null;
  }
}

function wireSecurity(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (loadedAbsPath && !url.startsWith('file://')) {
      event.preventDefault();
    }
  });
}

function createReportWindow(parent: BrowserWindow | null): BrowserWindow {
  const win = new BrowserWindow({
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    show: false,
    frame: true,
    autoHideMenuBar: true,
    parent: parent ?? undefined,
    modal: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });
  wireSecurity(win);
  win.on('closed', () => {
    if (reportWindow === win) {
      reportWindow = null;
      loadedAbsPath = null;
    }
  });
  return win;
}

/**
 * Load a sandbox-validated absolute path into the report window.
 * Reuses the singleton — replaces content and focuses.
 */
export async function openReportInAppBrowser(
  absPath: string,
  opts?: { title?: string }
): Promise<void> {
  const parent = getMainWindow();
  if (!reportWindow || reportWindow.isDestroyed()) {
    reportWindow = createReportWindow(parent);
  }
  const win = reportWindow;
  const title =
    opts?.title?.trim() ||
    (await extractTitleFromHtml(absPath)) ||
    basename(absPath);
  win.setTitle(title);
  centerOnParent(win, parent);
  try {
    await win.loadFile(absPath);
    loadedAbsPath = absPath;
    if (!win.isVisible()) win.show();
    win.focus();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn('loadFile failed for report', { absPath, err: msg });
    throw new Error(msg);
  }
}

/** Idempotent teardown for app quit. */
export function closeReportWindow(): void {
  if (!reportWindow || reportWindow.isDestroyed()) {
    reportWindow = null;
    loadedAbsPath = null;
    return;
  }
  reportWindow.close();
}
