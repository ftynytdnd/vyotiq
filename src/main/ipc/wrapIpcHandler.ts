/**
 * IPC handler wrapper.
 *
 * Every `ipcMain.handle()` registered through this helper gets:
 *   1. Structured `debug` logging on entry/exit, including duration.
 *   2. Structured `error` logging on throw, including the channel name
 *      and a fingerprint of the error so triage can grep for one ID.
 *   3. Errors RE-thrown unchanged, so the renderer's `invoke()` Promise
 *      still rejects normally.
 *
 * The previous implementation called `ipcMain.handle()` directly in every
 * `*.ipc.ts` file. Failures only surfaced if the individual handler had
 * its own try/catch — which most didn't. Several channels could throw
 * undiagnosable "object could not be cloned" or filesystem errors with no
 * breadcrumb in the main-process log. This wrapper closes that gap with
 * one call site.
 */

import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { logger } from '../logging/logger.js';
import { isProviderError } from '../providers/providerError.js';
import { isIpcCancelledError } from './ipcCancelledError.js';
import { isGitUserError } from '../workspace/gitUserError.js';

/**
 * Registers an IPC handler with logging + error capture. Drop-in
 * replacement for `ipcMain.handle(channel, handler)`. The generic
 * preserves the handler's original argument typing so call sites can
 * keep using `(_event, id: string, ...)` signatures verbatim.
 */
export function wrapIpcHandler<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  H extends (event: IpcMainInvokeEvent, ...args: any[]) => unknown | Promise<unknown>
>(channel: string, handler: H): void {
  const log = logger.child(`ipc/${channel}`);
  ipcMain.handle(channel, async (event, ...args) => {
    const started = Date.now();
    try {
      const out = await (handler as (
        e: IpcMainInvokeEvent,
        ...a: unknown[]
      ) => unknown | Promise<unknown>)(event, ...args);
      const ms = Date.now() - started;
      // Channels can fire many times per second during heavy chat
      // streaming — keep this at debug to avoid log noise.
      log.debug('ok', { ms });
      return out;
    } catch (err: unknown) {
      const ms = Date.now() - started;
      // `IpcCancelledError` is a benign user-driven outcome (e.g. they
      // dismissed a folder picker). It propagates to the renderer as
      // a rejected promise but must not surface in the main log as an
      // `error`-level event — the previous behaviour produced a full
      // stack trace for every cancelled workspace-add dialog (see
      // `vyotiq.log` line 217 in the May 16 capture), which polluted
      // triage. Downgrade to `info` and drop the stack.
      if (isIpcCancelledError(err)) {
        log.info('cancelled', { ms, reason: err.message });
        throw err;
      }
      // `ProviderError` represents a USER-CONFIG problem (bad URL,
      // wrong API key, expired billing, mistyped model name), not a
      // system bug. Log at WARN with the structured fields so triage
      // can grep but the renderer (which gets the friendly message
      // through the rejected promise) is the primary surface. Stack
      // traces are noise here — every one of them ends in `fetch`.
      if (isProviderError(err)) {
        log.warn('provider error', {
          ms,
          channel,
          kind: err.kind,
          status: err.status,
          providerId: err.providerId,
          message: err.friendlyMessage
        });
        throw err;
      }
      if (isGitUserError(err)) {
        log.warn('git user error', { ms, channel, message: err.message });
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      log.error('handler threw', { ms, message, stack });
      throw err;
    }
  });
}
