/**
 * Stream inactivity watchdog.
 *
 * Wraps a caller-supplied `AbortSignal` (typically the run-scoped one
 * threaded through every provider request) with an internal timer that
 * fires an abort if the caller goes `timeoutMs` without a `poke()`.
 * Transport layers (`openaiChatStream.ts`, `ollamaChatStream.ts`) call
 * `poke()` on every successful `reader.read()` and on every parsed SSE
 * frame so the timer only fires when the upstream has genuinely gone
 * silent — not merely slow.
 *
 * Without this watchdog a TCP connection held open by a misbehaving
 * provider with zero SSE frames turns into an indefinite "Awaiting
 * first token…" in the UI; the user's only recovery is to hit Stop.
 * With the watchdog, the fetch aborts with a dedicated
 * `StreamInactivityError` and `runLoop`'s existing retry-with-backoff
 * path handles it like any other transport failure.
 *
 * Design notes:
 *   - Never rethrows synchronously. `poke()` / `dispose()` are cheap
 *     and side-effect-only.
 *   - The parent signal, if supplied, is honored: when it aborts, the
 *     combined signal also aborts and the timer is cleared (preventing
 *     a late-firing timeout from double-aborting post-teardown).
 *   - `StreamInactivityError.name === 'StreamInactivityError'` so the
 *     orchestrator's `isAbortError` predicate returns `false` (the
 *     run-scoped parent signal is NOT aborted at the time the timer
 *     fires — only the inner combined controller is) and the run
 *     correctly retries instead of exiting silently.
 */

import { STREAM_INACTIVITY_TIMEOUT_MS } from '@shared/constants.js';

export class StreamInactivityError extends Error {
  constructor(timeoutMs: number) {
    super(`Provider stream inactive for ${timeoutMs} ms — aborting.`);
    this.name = 'StreamInactivityError';
  }
}

export interface InactivityWatch {
  /**
   * Signal to pass to `fetch()`. Aborts when the parent signal aborts
   * OR the inactivity timer fires. Either way the transport's SSE
   * reader throws out of its pending `read()` call and the generator
   * surfaces the error to `runLoop`.
   */
  readonly signal: AbortSignal;
  /**
   * Reset the inactivity timer. Call on every non-empty `reader.read()`
   * AND on every parsed frame. Safe to call after `dispose()` — becomes
   * a no-op.
   */
  poke(): void;
  /**
   * Stop the timer and detach the parent-signal listener. Call from a
   * `finally` block in the transport so the watchdog never outlives the
   * generator. Idempotent.
   */
  dispose(): void;
}

export interface InactivityWatchOptions {
  /** Override the default `STREAM_INACTIVITY_TIMEOUT_MS`. Milliseconds. */
  timeoutMs?: number;
  /**
   * Parent signal — typically the run-scoped abort controller from
   * `AgentV.startRun`. When it aborts the inner controller also aborts
   * and the timer is cleared so the inactivity timeout cannot fire
   * against an already-torn-down stream.
   */
  parent?: AbortSignal;
}

/**
 * Create a watchdog-backed signal. The returned `signal` must be
 * forwarded to `fetch()`; `poke()` must be called by the transport on
 * every read; `dispose()` must be called in a `finally` block once the
 * stream closes.
 */
export function createInactivityWatch(opts: InactivityWatchOptions = {}): InactivityWatch {
  const timeoutMs = opts.timeoutMs ?? STREAM_INACTIVITY_TIMEOUT_MS;
  const ctrl = new AbortController();

  let disposed = false;
  let timer: NodeJS.Timeout | null = null;

  const fire = (): void => {
    if (disposed) return;
    // Surface the dedicated error type via `ctrl.abort(reason)` so any
    // caller that inspects `signal.reason` can distinguish inactivity
    // from a plain user-cancel. Fallback to `.abort()` on older runtimes
    // that reject the reason arg (none of our targets, but defensive).
    const err = new StreamInactivityError(timeoutMs);
    try {
      (ctrl as AbortController & { abort: (reason?: unknown) => void }).abort(err);
    } catch {
      ctrl.abort();
    }
  };

  const arm = (): void => {
    if (disposed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(fire, timeoutMs);
  };

  // Parent-signal propagation. If the parent aborts first, we tear down
  // the inner timer but do NOT re-abort the inner controller with a
  // StreamInactivityError — we propagate the parent's abort reason so
  // downstream `isAbortError(err, parent)` returns `true` (user Stop).
  const onParentAbort = (): void => {
    if (disposed) return;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    try {
      const reason = (opts.parent as AbortSignal & { reason?: unknown })?.reason;
      (ctrl as AbortController & { abort: (reason?: unknown) => void }).abort(reason);
    } catch {
      ctrl.abort();
    }
  };
  if (opts.parent) {
    if (opts.parent.aborted) {
      // Propagate the pre-existing abort BEFORE arming so callers never
      // see a live signal they think is fresh.
      onParentAbort();
    } else {
      opts.parent.addEventListener('abort', onParentAbort, { once: true });
    }
  }

  // Arm immediately so the "connected but never sends a byte" case fires.
  arm();

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (opts.parent) {
      try {
        opts.parent.removeEventListener('abort', onParentAbort);
      } catch {
        /* standard API; defensive against polyfills. */
      }
    }
  };

  return {
    signal: ctrl.signal,
    poke: arm,
    dispose
  };
}

/**
 * True iff the given error is the watchdog-produced timeout (not a user
 * cancel, not a generic abort). Kept here so transports can emit a
 * structured log line when inactivity fires without a second type check.
 */
export function isStreamInactivityError(err: unknown): err is StreamInactivityError {
  if (err instanceof StreamInactivityError) return true;
  const name = (err as { name?: unknown } | null)?.name;
  return typeof name === 'string' && name === 'StreamInactivityError';
}
