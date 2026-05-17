/**
 * Confirm bus. The bridge between tools (which call `ctx.confirm(message)`)
 * and the renderer (which renders an inline confirm UI). Any tool needing
 * user approval triggers an IPC round-trip through here.
 */

import { randomUUID } from 'node:crypto';
import { IPC } from '@shared/constants.js';
import type { EditApprovalPayload, ConfirmResponse } from '@shared/types/ipc.js';
import { getMainWindow } from '../window/getMainWindow.js';
import { logger } from '../logging/logger.js';

const log = logger.child('confirm');

/**
 * What the resolver hands back to the tool. `approved` is the actual
 * gate; `acceptAllRemaining` is the "Accept all remaining in this
 * run" latch flipped by the `EditApprovalDialog`. Legacy text-only
 * confirms never set the latch, so the value is always `false` for
 * them.
 *
 * `reason` (Audit fix H-04): distinguishes the four ways a confirm
 * can resolve to `approved: false`:
 *   - `'denied'`     — user actively clicked Deny
 *   - `'timeout'`    — server-side TIMEOUT_MS expired without a reply
 *   - `'aborted'`    — run-scoped signal fired (Stop click, run abort)
 *   - `'no-ui'`      — no live BrowserWindow / send-failed; failed
 *                       closed without ever showing the user a prompt
 *   - `'approved'`   — user clicked Allow (sentinel value matched on
 *                       `approved === true`)
 *
 * Tools use the reason to pick the right user-facing failure message:
 * `'denied'` → "User denied permission"; the others → a
 * "host could not show the prompt" / "timed out" / "aborted" message
 * so the model + the user aren't told a denial happened when it didn't.
 */
export type ConfirmReason = 'approved' | 'denied' | 'timeout' | 'aborted' | 'no-ui';

export interface ConfirmResult {
  approved: boolean;
  acceptAllRemaining: boolean;
  reason: ConfirmReason;
}

interface PendingConfirm {
  resolve: (result: ConfirmResult) => void;
  timer: NodeJS.Timeout;
  /** Guards against any double-settle path (timeout firing in the same
   *  microtask as a renderer reply, shutdown drain stomping a real reply,
   *  etc.). Promise.resolve is already idempotent, but the flag makes the
   *  invariant explicit and gives us a structured log when it fires. */
  resolved: boolean;
  /**
   * Caller-supplied abort signal + its listener. When a `requestConfirm`
   * call forwards the run-scoped `AbortSignal` (sub-agent cancellation,
   * Stop button, shutdown drain that arrives before `clearAllPending`),
   * `finalize` MUST detach the listener or the AbortController holds a
   * reference to this map entry forever — a classic long-lived-signal
   * leak visible only under heavy chat churn. Both fields are `null`
   * for the legacy signal-less call path so the predicate stays cheap
   * (`if (entry.signal)` is truthy-checked before use).
   */
  signal: AbortSignal | null;
  onAbort: (() => void) | null;
}

const pending = new Map<string, PendingConfirm>();

const TIMEOUT_MS = 5 * 60 * 1000;

function finalize(
  id: string,
  entry: PendingConfirm,
  result: ConfirmResult,
  reason: 'renderer-reply' | 'timeout' | 'aborted' | 'shutdown' | 'send-failed'
): void {
  if (entry.resolved) {
    log.warn('double-settle suppressed on confirm', { id, reason });
    return;
  }
  entry.resolved = true;
  clearTimeout(entry.timer);
  // Drop the abort listener (if any) BEFORE clearing the map entry so a
  // late-firing signal can't re-enter `finalize` with a stale reference.
  if (entry.signal && entry.onAbort) {
    try {
      entry.signal.removeEventListener('abort', entry.onAbort);
    } catch {
      /* AbortSignal.removeEventListener is standard, but defensive
         against any non-standard polyfill that throws. */
    }
  }
  pending.delete(id);
  // Notify the renderer that the request is gone whenever the resolution
  // did NOT originate there. Without this, a server-side timeout (or a
  // shutdown drain) would leave the modal rendered until the user clicks
  // Deny — by which point we'd already have resolved the request and the
  // click would fall on a dead handler.
  if (reason !== 'renderer-reply') {
    try {
      const win = getMainWindow();
      if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
        win.webContents.send(IPC.TOOLS_CANCEL_CONFIRM, id);
      }
    } catch (err) {
      log.warn('failed to broadcast confirm:cancel', { id, reason, err });
    }
  }
  try {
    entry.resolve(result);
  } catch (err) {
    log.error('confirm resolver threw', { id, reason, err });
  }
}

/**
 * Shorthand sentinels by reason. `approved === true` is reserved for
 * the user-clicked-Allow path; every other `approved: false` outcome
 * carries a distinct `reason` so the calling tool can tell "user
 * denied" apart from "no UI", "timed out", or "run aborted".
 *
 * `denied` is kept for callers that need the legacy semantics
 * (renderer reply with `false`); the host-side fail-closed paths use
 * `noUiResult` / `timeoutResult` / `abortedResult` explicitly.
 */
const denied: ConfirmResult = { approved: false, acceptAllRemaining: false, reason: 'denied' };
const noUiResult: ConfirmResult = { approved: false, acceptAllRemaining: false, reason: 'no-ui' };
const timeoutResult: ConfirmResult = { approved: false, acceptAllRemaining: false, reason: 'timeout' };
const abortedResult: ConfirmResult = { approved: false, acceptAllRemaining: false, reason: 'aborted' };
const approvedOnly: ConfirmResult = { approved: true, acceptAllRemaining: false, reason: 'approved' };

/**
 * Per-run "accept all remaining edits" latch.
 *
 * When the user clicks "Accept all remaining in this run" inside the
 * `EditApprovalDialog`, the toolRunner sets `runId → true` here so
 * subsequent `confirmEdit` calls in the SAME run resolve immediately
 * as approved without re-prompting. Cleared on `clearEditApprovalLatch`
 * (called by the run lifecycle).
 *
 * NOT used by the legacy text confirms — they always re-prompt.
 */
const editApprovalLatch = new Set<string>();

/** Returns `true` when the run has the auto-accept latch flipped. */
export function isEditApprovalLatched(runId: string): boolean {
  return editApprovalLatch.has(runId);
}

/** Flip the latch — called by `toolRunner` after a `confirmEdit` reply
 *  carries `acceptAllRemaining: true`. */
export function setEditApprovalLatch(runId: string): void {
  if (runId) editApprovalLatch.add(runId);
}

/** Clear the latch — called when a run ends (finalize / abort) so the
 *  flag never leaks across runs. */
export function clearEditApprovalLatch(runId: string): void {
  editApprovalLatch.delete(runId);
}

/**
 * Request user confirmation for a tool action.
 *
 * Returns a {@link ConfirmResult} so callers (specifically the `edit`
 * and `delete` tools, which forward the `EditApprovalPayload`) can see
 * the "Accept all remaining in this run" latch flag in addition to
 * the boolean gate.
 *
 * @param message  Text fallback prompt (used by legacy confirms; the
 *                 `EditApprovalDialog` ignores this when `payload` is
 *                 set).
 * @param signal   Optional abort signal. When it fires, the pending
 *                 confirm is finalized as denied (`approved: false`)
 *                 and the renderer modal is dismissed via
 *                 `IPC.TOOLS_CANCEL_CONFIRM`. Without this plumbing
 *                 a tool blocked on approval would hang for up to
 *                 `TIMEOUT_MS` (5 min) after the user hit Stop.
 * @param payload  Optional structured payload. When supplied, the
 *                 renderer mounts the richer `EditApprovalDialog`
 *                 with a full diff and three buttons (Deny / Accept
 *                 / Accept all remaining).
 */
export function requestConfirm(
  message: string,
  signal?: AbortSignal,
  payload?: EditApprovalPayload
): Promise<ConfirmResult> {
  // Short-circuit when the signal was already aborted at the call
  // site — no point in emitting a modal the renderer will immediately
  // be told to cancel.
  if (signal?.aborted === true) {
    return Promise.resolve(abortedResult);
  }
  const win = getMainWindow();
  // Fail CLOSED when the window is gone or torn down. Audit fix H-04:
  // resolve with `noUiResult` (reason: 'no-ui') so calling tools can
  // tell "user denied" apart from "host could not show the prompt".
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
    log.warn('confirm requested but no live window; failing closed');
    return Promise.resolve(noUiResult);
  }
  const id = randomUUID();
  return new Promise<ConfirmResult>((resolve) => {
    const entry: PendingConfirm = {
      resolve,
      resolved: false,
      signal: signal ?? null,
      onAbort: null,
      timer: setTimeout(() => {
        const cur = pending.get(id);
        if (cur) finalize(id, cur, timeoutResult, 'timeout');
      }, TIMEOUT_MS)
    };
    if (signal) {
      // `once: true` is belt-and-suspenders; `finalize` also detaches
      // the listener explicitly so a misbehaving polyfill that ignores
      // `once` still cleans up.
      const onAbort = (): void => {
        const cur = pending.get(id);
        if (cur) finalize(id, cur, abortedResult, 'aborted');
      };
      entry.onAbort = onAbort;
      signal.addEventListener('abort', onAbort, { once: true });
    }
    pending.set(id, entry);
    try {
      win.webContents.send(IPC.TOOLS_REQUEST_CONFIRM, {
        id,
        message,
        ...(payload ? { payload } : {})
      });
    } catch (err) {
      // Window died between the liveness check above and the send —
      // unwind the pending entry and fail closed with the no-ui
      // reason so the tool surfaces "host could not show the prompt"
      // instead of "user denied permission".
      log.warn('failed to send confirm request; failing closed', { id, err });
      const cur = pending.get(id);
      if (cur) finalize(id, cur, noUiResult, 'send-failed');
    }
  });
}

/**
 * Resolve a pending confirm with the renderer's reply.
 *
 * Accepts the legacy boolean reply shape AND the richer
 * `{ approved, acceptAllRemaining }` envelope used by
 * `EditApprovalDialog`. Booleans are normalized so the boolean callers
 * (`ConfirmDialog`, destructive-command path) need no churn.
 */
export function settleConfirm(id: string, reply: ConfirmResponse): void {
  const entry = pending.get(id);
  if (!entry) {
    // The renderer occasionally re-sends a settle for an id we've already
    // finalized (e.g. duplicate click). It's harmless but worth a debug
    // breadcrumb. Audit fix L-03: dropped from `warn` to `debug` so
    // duplicate-click noise doesn't show up in normal-operation logs.
    log.debug('settleConfirm for unknown id', { id });
    return;
  }
  let result: ConfirmResult;
  if (typeof reply === 'boolean') {
    result = reply ? approvedOnly : denied;
  } else {
    const approved = reply.approved === true;
    result = {
      approved,
      acceptAllRemaining: approved && reply.acceptAllRemaining === true,
      // Renderer replies always carry an explicit user choice — either
      // 'approved' or 'denied'. The other reasons are reserved for
      // host-side fail-closed paths.
      reason: approved ? 'approved' : 'denied'
    };
  }
  finalize(id, entry, result, 'renderer-reply');
}

/**
 * Drain every pending confirm as no-ui at shutdown. Called from the
 * app's `before-quit` handler so we never leak timers or unresolved
 * promises. Safe to call multiple times; the map is cleared in-place.
 *
 * Audit fix H-04: shutdown-aborted confirms resolve with `noUiResult`
 * (reason: 'no-ui') instead of `denied` so a tool that was awaiting
 * approval at quit-time surfaces "host could not show the prompt"
 * rather than "user denied permission" — a denial implies a user
 * choice that never happened.
 */
export function clearAllPending(): void {
  const count = pending.size;
  if (count > 0) log.info('draining pending confirms at shutdown', { count });
  // Snapshot before iterating because `finalize` mutates the map.
  for (const [id, entry] of [...pending.entries()]) {
    finalize(id, entry, noUiResult, 'shutdown');
  }
}
