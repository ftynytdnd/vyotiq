/**
 * Bring the main window forward when agent work needs user attention.
 */

import { app, BrowserWindow } from 'electron';
import { getSettings } from '../settings/settingsStore.js';
import { getMainWindow } from './getMainWindow.js';

export type UserAttentionReason =
  | 'second-instance'
  | 'ask-user'
  | 'run-settled'
  | 'scheduled-enqueue';

const DEBOUNCE_MS = 2_000;
const lastFiredAt = new Map<UserAttentionReason, number>();
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function wakeOnAgentEventsEnabled(): boolean {
  const ui = getSettings().ui as { focus?: { wakeOnAgentEvents?: boolean } } | undefined;
  return ui?.focus?.wakeOnAgentEvents !== false;
}

function focusMainWindow(): void {
  const win = getMainWindow();
  if (!win || win.isDestroyed()) {
    const fallback = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
    if (!fallback) return;
    if (fallback.isMinimized()) fallback.restore();
    if (process.platform === 'darwin') {
      void app.focus({ steal: true });
    }
    if (!fallback.isFocused()) {
      fallback.focus();
      if (process.platform === 'win32') fallback.flashFrame(true);
    }
    return;
  }
  if (win.isMinimized()) win.restore();
  if (process.platform === 'darwin') {
    void app.focus({ steal: true });
  }
  if (!win.isFocused()) {
    win.focus();
    if (process.platform === 'win32') win.flashFrame(true);
  }
}

/** Request OS focus for the main window (debounced per reason). */
export function requestUserAttention(reason: UserAttentionReason): void {
  if (!wakeOnAgentEventsEnabled()) return;
  const now = Date.now();
  const last = lastFiredAt.get(reason) ?? 0;
  if (now - last < DEBOUNCE_MS) return;
  lastFiredAt.set(reason, now);

  if (debounceTimer !== null) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    focusMainWindow();
  }, 0);
}

/** Test-only reset. */
export function __test_resetUserAttention(): void {
  lastFiredAt.clear();
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  debounceTimer = null;
}
