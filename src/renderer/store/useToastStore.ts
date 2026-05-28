/**
 * Lightweight global toast queue used to surface async-IPC failures the
 * UI cannot resolve in-place. Single source of truth for renderer-wide
 * notifications. Info/success toasts auto-dismiss after ~4s; danger
 * toasts persist until dismissed. Callers may pass a custom duration.
 * Stack depth is capped so a burst
 * of failures never floods the layout.
 *
 * Renders via `<ToastHost />` mounted once near the application root.
 */

import { create } from 'zustand';

type ToastTone = 'info' | 'success' | 'danger';

export interface Toast {
  id: string;
  message: string;
  tone: ToastTone;
}

interface ToastStore {
  toasts: Toast[];
  show: (message: string, tone?: ToastTone, durationMs?: number) => void;
  dismiss: (id: string) => void;
  /**
   * Freeze a toast's auto-expire timer. Used by `ToastHost` while the
   * cursor is hovering a row (or focus is on its dismiss button) so a
   * user reading a long message isn't ambushed by the panel
   * disappearing mid-read. Idempotent on unknown ids.
   */
  pause: (id: string) => void;
  /**
   * Resume a previously-paused toast. Schedules a fresh timer for the
   * REMAINING duration captured at pause time, not the original full
   * duration — a half-elapsed toast finishes its remaining ~2 s
   * instead of resetting to the full 4 s.
   */
  resume: (id: string) => void;
}

const DEFAULT_DURATION_MS = 4000;
/** Danger toasts persist until dismissed. */
const PERSISTENT_DURATION_MS = 0;
const MAX_STACK = 4;

let serial = 0;
function nextId(): string {
  serial = (serial + 1) % Number.MAX_SAFE_INTEGER;
  return `toast-${Date.now().toString(36)}-${serial}`;
}

/**
 * Per-toast lifecycle bookkeeping kept outside the Zustand state
 * because timer handles aren't serializable and don't need to drive
 * re-renders. We track:
 *   - `timer`: the active `setTimeout` handle (null while paused).
 *   - `expiresAt`: the wall-clock time the toast SHOULD vanish at
 *     when running. Used to compute the remaining duration on resume.
 *   - `remaining`: when paused, the leftover ms captured at pause.
 */
interface TimerEntry {
  timer: ReturnType<typeof setTimeout> | null;
  expiresAt: number;
  remaining: number;
}
const timers = new Map<string, TimerEntry>();

export const useToastStore = create<ToastStore>((set, get) => {
  function scheduleExpire(id: string, durationMs: number): void {
    if (durationMs <= 0) {
      timers.set(id, { timer: null, expiresAt: Number.POSITIVE_INFINITY, remaining: 0 });
      return;
    }
    const handle = setTimeout(() => {
      timers.delete(id);
      // Re-read state inside the timer so a dismiss-then-bulk-clear
      // sequence cannot resurrect a removed toast.
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, durationMs);
    timers.set(id, {
      timer: handle,
      expiresAt: Date.now() + durationMs,
      remaining: durationMs
    });
  }

  function clearTimer(id: string): void {
    const entry = timers.get(id);
    if (entry?.timer) clearTimeout(entry.timer);
    timers.delete(id);
  }

  return {
    toasts: [],

    show: (message, tone = 'info', durationMs?: number) => {
      const id = nextId();
      const next: Toast = { id, message, tone };
      const resolvedDuration =
        durationMs ??
        (tone === 'danger' ? PERSISTENT_DURATION_MS : DEFAULT_DURATION_MS);
      const cur = get().toasts;
      // Drop the oldest entries if we exceed the stack cap so the
      // panel never grows past `MAX_STACK` rows. The dropped entries'
      // timers are cleared so they can't fire after their toast has
      // been removed from the visible queue.
      const trimmed =
        cur.length >= MAX_STACK ? cur.slice(cur.length - (MAX_STACK - 1)) : cur;
      const dropped = cur.length - trimmed.length;
      if (dropped > 0) {
        for (const t of cur.slice(0, dropped)) clearTimer(t.id);
      }
      set({ toasts: [...trimmed, next] });
      scheduleExpire(id, resolvedDuration);
    },

    dismiss: (id) => {
      clearTimer(id);
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    },

    pause: (id) => {
      const entry = timers.get(id);
      if (!entry || entry.timer === null) return;
      clearTimeout(entry.timer);
      const remaining = Math.max(0, entry.expiresAt - Date.now());
      timers.set(id, { timer: null, expiresAt: entry.expiresAt, remaining });
    },

    resume: (id) => {
      const entry = timers.get(id);
      // Only resume entries that are actually paused. An unknown id
      // (toast already dismissed) or a still-running timer means there
      // is nothing to do.
      if (!entry || entry.timer !== null) return;
      scheduleExpire(id, entry.remaining);
    }
  };
});
