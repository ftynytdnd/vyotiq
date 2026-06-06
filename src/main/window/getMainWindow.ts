/**
 * Singleton ref to the main shell BrowserWindow. Used by IPC handlers and
 * child windows (report browser) that need the primary app surface.
 */

import { BrowserWindow } from 'electron';

let mainWindowRef: BrowserWindow | null = null;

export function setMainWindow(win: BrowserWindow | null): void {
  mainWindowRef = win;
  if (win) {
    win.on('closed', () => {
      if (mainWindowRef === win) mainWindowRef = null;
    });
  }
}

export function getMainWindow(): BrowserWindow | null {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) return mainWindowRef;
  const wins = BrowserWindow.getAllWindows();
  return wins.find((w) => !w.isDestroyed()) ?? null;
}
