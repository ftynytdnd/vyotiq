/**
 * Single source of truth for sending an event to the renderer's
 * `webContents` defensively. Every site that pushes data into the
 * renderer (timeline events, snapshot-changed broadcasts, confirm
 * cancellations, checkpoint mutations, window-state changes, …) used
 * to re-implement the same 4-line guard:
 *
 *     const win = getMainWindow();
 *     if (!win || win.isDestroyed()) return;
 *     const wc = win.webContents;
 *     if (!wc || wc.isDestroyed()) return;
 *     try { wc.send(channel, ...args); } catch { ...renderer gone... }
 *
 * Six call sites carried inline copies (chat.ipc, contextSummary.ipc,
 * checkpoints.ipc x3, confirmBus, idleSummaryRuntime, createMainWindow).
 * Each was correct in isolation but the duplication was a maintenance
 * hazard — a security-critical pattern (renderer death must NEVER
 * crash the orchestrator) belongs in one place. Audit P3-3 (2026-05).
 *
 * Behaviour:
 *   - Resolves `getMainWindow()` per-call rather than caching, so a
 *     mid-run renderer reload is observed on the next emit (matches
 *     the chat.ipc safeSend rationale).
 *   - Returns silently when no live window exists, when the window /
 *     webContents is destroyed, or when the synchronous `send` throws
 *     (Electron occasionally throws on a destroyed webContents that
 *     the isDestroyed() probe didn't catch — typically during
 *     teardown).
 *   - Logs throws at debug so triage can grep one line per affected
 *     channel without polluting normal-operation logs.
 *
 * Pure / no-throw — returns `false` when nothing was delivered.
 */

import { getMainWindow } from './getMainWindow.js';
import { logger } from '../logging/logger.js';

const log = logger.child('window/safeWebContentsSend');

/**
 * Defensively send `args` over `channel` to the renderer's webContents.
 * No-op when the window or webContents is destroyed. Catches
 * synchronous throws and logs at debug.
 *
 * @returns `true` when `webContents.send` ran; `false` when skipped or threw.
 */
export function safeWebContentsSend(channel: string, ...args: unknown[]): boolean {
  try {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return false;
    const wc = win.webContents;
    if (!wc || wc.isDestroyed()) return false;
    wc.send(channel, ...args);
    return true;
  } catch (err) {
    log.debug('webContents.send failed; renderer likely gone', { channel, err });
    return false;
  }
}
