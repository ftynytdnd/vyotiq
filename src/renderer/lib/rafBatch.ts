/**
 * Tiny batching helper that collapses high-frequency pushes into one
 * flush per animation frame. Used by `chatChannel.ts` to coalesce
 * `tool-call-args-delta` events arriving at provider speeds (often
 * dozens per second for a long `edit.newString`) so the renderer
 * never sees more than one `setState` per ~16ms.
 *
 * Pattern from "Streaming Backends & React: Controlling Re-render
 * Chaos" (sitepoint.com, 2026): never call `setState` from a stream
 * callback — buffer in a mutable ref and flush via
 * `requestAnimationFrame`. RAF auto-aligns to the display refresh
 * rate, auto-pauses in background tabs, and synchronizes with the
 * compositor — none of which `setInterval` does.
 *
 * Contract:
 *   - `push(item)` — queue an item. If no flush is pending,
 *     `requestAnimationFrame` is scheduled. If already pending, the
 *     item just appends to the batch.
 *   - `flush` callback fires once per frame with the FULL batch
 *     accumulated since the last flush. Empty batches don't fire.
 *   - `cancel()` — abort any pending flush and clear the buffer.
 *     Used on chatChannel teardown so the renderer doesn't leak a
 *     pending RAF into a torn-down store.
 *
 * Pure module. No DOM beyond `requestAnimationFrame` /
 * `cancelAnimationFrame`. Test-friendly: when `window` is undefined
 * (Node / vitest without a DOM), falls back to `queueMicrotask` so
 * the batcher still operates deterministically in unit tests.
 */

export interface RafBatcher<T> {
  /** Queue an item for the next frame's flush. */
  push: (item: T) => void;
  /** Drain any buffered items immediately (boundary events). */
  flush: () => void;
  /** Cancel any pending flush and clear the buffer. */
  cancel: () => void;
  /** Number of items currently buffered (exposed for tests). */
  readonly size: number;
}

type RafFn = (cb: FrameRequestCallback) => number;
type CancelFn = (handle: number) => void;

/**
 * Resolve the scheduling primitives. We capture them at construction
 * time so a test can stub them on `globalThis.requestAnimationFrame`
 * before instantiating the batcher.
 */
function pickScheduler(): { schedule: RafFn; cancel: CancelFn } {
  if (typeof requestAnimationFrame === 'function') {
    return {
      schedule: requestAnimationFrame,
      cancel: typeof cancelAnimationFrame === 'function'
        ? cancelAnimationFrame
        : () => {
          /* no-op when only schedule is available */
        }
    };
  }
  // Test / SSR fallback: microtask drains as soon as the call stack
  // empties. Returns a synthetic handle so the `cancel` symmetry
  // holds. A no-op cancel is safe — by the time a test calls
  // `cancel()` after `push()`, the microtask has typically already
  // drained. Tests can also call `cancel()` *before* `push()` and
  // get a clean slate.
  let nextHandle = 1;
  return {
    schedule: (cb) => {
      const handle = nextHandle++;
      queueMicrotask(() => cb(performance.now?.() ?? Date.now()));
      return handle;
    },
    cancel: () => {
      /* microtasks can't be cancelled; the batcher's own guard
       * ensures flushes after cancel see an empty buffer. */
    }
  };
}

export function createRafBatcher<T>(
  onFlush: (batch: T[]) => void
): RafBatcher<T> {
  const { schedule, cancel } = pickScheduler();
  let buffer: T[] = [];
  let pending: number | null = null;
  let cancelled = false;

  const drain = () => {
    pending = null;
    if (cancelled) {
      buffer = [];
      return;
    }
    if (buffer.length === 0) return;
    // Hand off the current batch and immediately reset so any
    // `push()` calls inside `flush` (re-entrant emit, e.g. a
    // selector triggering another delta) land in a fresh buffer
    // and schedule the NEXT frame instead of mutating this one.
    const batch = buffer;
    buffer = [];
    try {
      onFlush(batch);
    } finally {
      // If items were pushed during flush, schedule the next frame.
      if (buffer.length > 0 && !cancelled && pending === null) {
        pending = schedule(drain);
      }
    }
  };

  const api: RafBatcher<T> = {
    push(item: T) {
      if (cancelled) return;
      buffer.push(item);
      if (pending === null) {
        pending = schedule(drain);
      }
    },
    flush() {
      if (pending !== null) {
        cancel(pending);
        pending = null;
      }
      if (buffer.length === 0) return;
      const batch = buffer;
      buffer = [];
      try {
        onFlush(batch);
      } finally {
        if (buffer.length > 0 && !cancelled && pending === null) {
          pending = schedule(drain);
        }
      }
    },
    cancel() {
      cancelled = true;
      if (pending !== null) {
        cancel(pending);
        pending = null;
      }
      buffer = [];
    },
    get size() {
      return buffer.length;
    }
  };
  return api;
}
