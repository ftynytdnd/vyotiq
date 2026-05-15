/**
 * Singleton ref to the focused main BrowserWindow. Used by IPC handlers that
 * need to push events back to the renderer.
 */

import { BrowserWindow } from 'electron';

export function getMainWindow(): BrowserWindow | null {
  const wins = BrowserWindow.getAllWindows();
  return wins.find((w) => !w.isDestroyed()) ?? null;
}
