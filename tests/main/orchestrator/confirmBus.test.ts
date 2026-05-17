/**
 * `confirmBus.ts` tests. The Phase-1 hardening added the `resolved`
 * flag to prevent double-settle. We exercise:
 *
 *   - happy path (renderer reply)
 *   - failing closed when no main window is available
 *   - duplicate `settleConfirm` calls are ignored
 *   - timeout settles to denied
 *   - `clearAllPending` drains every queued confirm and is idempotent
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sentMessages: Array<{ channel: string; payload: unknown }> = [];

vi.mock('@main/window/getMainWindow', () => ({
  // Must include the `isDestroyed` predicates the production code now
  // calls before every `webContents.send` (mid-reload teardown guard).
  // `getMainWindow()` already filters destroyed windows, but confirmBus
  // re-checks so a window torn down between acquisition and send is
  // caught. Tests return a live-shape stub.
  getMainWindow: vi.fn(() => ({
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      send: vi.fn((channel: string, payload: unknown) => {
        sentMessages.push({ channel, payload });
      })
    }
  }))
}));

import { clearAllPending, requestConfirm, settleConfirm } from '@main/orchestrator/confirmBus';
import { getMainWindow } from '@main/window/getMainWindow';

beforeEach(() => {
  sentMessages.length = 0;
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('confirmBus', () => {
  it('requestConfirm sends an IPC message and resolves on settle', async () => {
    const promise = requestConfirm('Delete file?');
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]?.channel).toBe('tools:request-confirm');
    const id = (sentMessages[0]?.payload as { id: string }).id;
    settleConfirm(id, true);
    // Audit fix H-04: envelope carries a `reason` discriminator.
    await expect(promise).resolves.toEqual({ approved: true, acceptAllRemaining: false, reason: 'approved' });
  });

  it('returns a no-ui envelope immediately when no main window is available', async () => {
    vi.mocked(getMainWindow).mockReturnValueOnce(null as never);
    const result = await requestConfirm('test');
    // Audit fix H-04: missing-window path resolves with reason
    // 'no-ui' so the calling tool can surface "host couldn't show
    // the prompt" instead of falsely claiming the user denied.
    expect(result).toEqual({ approved: false, acceptAllRemaining: false, reason: 'no-ui' });
  });

  it('ignores duplicate settle calls for the same id', async () => {
    const promise = requestConfirm('approve once');
    const id = (sentMessages[0]?.payload as { id: string }).id;
    settleConfirm(id, true);
    // Second settle is a no-op — the underlying Promise.resolve is
    // idempotent, but the flag prevents the resolver function being
    // called twice.
    settleConfirm(id, false);
    await expect(promise).resolves.toEqual({ approved: true, acceptAllRemaining: false, reason: 'approved' });
  });

  it('settleConfirm for an unknown id is silently ignored', () => {
    expect(() => settleConfirm('does-not-exist', true)).not.toThrow();
  });

  it('clearAllPending drains every pending confirm as no-ui at shutdown', async () => {
    const a = requestConfirm('one');
    const b = requestConfirm('two');
    expect(sentMessages).toHaveLength(2);
    clearAllPending();
    // Audit fix H-04: shutdown drain resolves with reason 'no-ui'
    // so a tool that was awaiting approval at quit-time surfaces
    // "host could not show the prompt" rather than a user denial
    // that never happened.
    await expect(a).resolves.toEqual({ approved: false, acceptAllRemaining: false, reason: 'no-ui' });
    await expect(b).resolves.toEqual({ approved: false, acceptAllRemaining: false, reason: 'no-ui' });
    // Idempotent: a second call must not throw or revive anything.
    expect(() => clearAllPending()).not.toThrow();
  });

  it('times out an unanswered confirm with reason timeout', async () => {
    vi.useFakeTimers();
    const promise = requestConfirm('idle');
    // Default timeout is 5 minutes — fast-forward past it.
    vi.advanceTimersByTime(5 * 60 * 1000 + 100);
    // Audit fix H-04: timeout resolves with reason 'timeout' so the
    // tool can render a precise "prompt timed out" message.
    await expect(promise).resolves.toEqual({ approved: false, acceptAllRemaining: false, reason: 'timeout' });
  });

  describe('AbortSignal integration (plan §5)', () => {
    /**
     * The run-scoped signal must dismiss a pending confirm the instant
     * it fires. Without this wiring a tool blocked on user approval
     * would park the sub-agent worker for up to 5 min after the user
     * hit Stop, and the modal would stay rendered until the timeout.
     */
    it('resolves false when the signal aborts after the request', async () => {
      const ctrl = new AbortController();
      const promise = requestConfirm('delete foo.ts?', ctrl.signal);
      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0]?.channel).toBe('tools:request-confirm');
      ctrl.abort();
      // Audit fix H-04: abort path resolves with reason 'aborted'.
      await expect(promise).resolves.toEqual({ approved: false, acceptAllRemaining: false, reason: 'aborted' });
      // Broadcast the cancel so the renderer modal dismisses itself
      // — otherwise the user sees a dialog pointing at a dead handler.
      const cancels = sentMessages.filter((m) => m.channel === 'tools:cancel-confirm');
      expect(cancels).toHaveLength(1);
    });

    it('short-circuits synchronously when the signal is pre-aborted', async () => {
      const ctrl = new AbortController();
      ctrl.abort();
      const promise = requestConfirm('noop', ctrl.signal);
      // Pre-aborted guard also reports reason 'aborted'.
      await expect(promise).resolves.toEqual({ approved: false, acceptAllRemaining: false, reason: 'aborted' });
      // No IPC traffic at all — the pre-aborted guard must exit
      // before `webContents.send` fires so the renderer never paints
      // a modal we'd immediately have to tear down.
      expect(sentMessages).toHaveLength(0);
    });

    it('does not leak the abort listener after a normal renderer reply', async () => {
      // Hook into the raw AbortSignal so we can observe listener
      // churn. The internal signal carries a private listener count
      // via `addEventListener` / `removeEventListener`; we use a
      // spy on the prototype to count both calls.
      const ctrl = new AbortController();
      const addSpy = vi.spyOn(ctrl.signal, 'addEventListener');
      const removeSpy = vi.spyOn(ctrl.signal, 'removeEventListener');
      const promise = requestConfirm('normal reply', ctrl.signal);
      expect(addSpy).toHaveBeenCalledTimes(1);
      const id = (sentMessages[0]?.payload as { id: string }).id;
      settleConfirm(id, true);
      await expect(promise).resolves.toEqual({ approved: true, acceptAllRemaining: false, reason: 'approved' });
      // `finalize` MUST have removed the listener so aborting AFTER
      // the reply cannot re-enter the finalize path.
      expect(removeSpy).toHaveBeenCalledTimes(1);
      // Post-reply abort is a no-op: no double-resolution, no extra
      // cancel broadcast (the renderer already answered).
      ctrl.abort();
      const cancelsForId = sentMessages.filter(
        (m) =>
          m.channel === 'tools:cancel-confirm' &&
          (m.payload as unknown) === id
      );
      expect(cancelsForId).toHaveLength(0);
    });

    it('treats abort as a deny (no renderer reply consumed)', async () => {
      // Belt-and-suspenders against a race: the renderer could in
      // principle click Allow in the same microtask the signal
      // aborts. Whichever wins must not double-settle; the other
      // path must log and skip. Here we exercise "abort wins":
      const ctrl = new AbortController();
      const promise = requestConfirm('race', ctrl.signal);
      const id = (sentMessages[0]?.payload as { id: string }).id;
      ctrl.abort();
      // A late settle arriving AFTER the abort must be a no-op.
      settleConfirm(id, true);
      // Abort-wins path reports reason 'aborted'.
      await expect(promise).resolves.toEqual({ approved: false, acceptAllRemaining: false, reason: 'aborted' });
    });
  });
});
