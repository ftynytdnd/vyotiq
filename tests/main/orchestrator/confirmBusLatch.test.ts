/**
 * Coverage for the per-run auto-accept latch added to `confirmBus`.
 * The latch is what powers the "Accept all remaining in this run"
 * button inside `EditApprovalDialog` — once flipped, subsequent
 * `confirmEdit` calls under the same `runId` resolve as approved
 * without re-prompting until the run ends.
 *
 * We exercise the public surface only (set / clear / is-latched) and
 * verify the response shape that `settleConfirm` produces when the
 * renderer replies with `acceptAllRemaining: true`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const sentMessages: Array<{ channel: string; payload: unknown }> = [];
vi.mock('@main/window/getMainWindow', () => ({
  // Production confirmBus guards every send with `isDestroyed()`
  // checks on both the window and its `webContents` — mirror that
  // shape so the test stub passes the guard.
  getMainWindow: vi.fn(() => ({
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      send: (channel: string, payload: unknown) => {
        sentMessages.push({ channel, payload });
      }
    }
  }))
}));

import {
  requestConfirm,
  settleConfirm,
  setEditApprovalLatch,
  clearEditApprovalLatch,
  isEditApprovalLatched
} from '@main/orchestrator/confirmBus';

beforeEach(() => {
  sentMessages.length = 0;
  vi.restoreAllMocks();
});

describe('confirmBus / edit-approval latch', () => {
  it('latch lifecycle: set → is-latched → clear → not-latched', () => {
    const runId = 'run-latch-1';
    expect(isEditApprovalLatched(runId)).toBe(false);
    setEditApprovalLatch(runId);
    expect(isEditApprovalLatched(runId)).toBe(true);
    clearEditApprovalLatch(runId);
    expect(isEditApprovalLatched(runId)).toBe(false);
  });

  it('latch is scoped per run id and never bleeds across runs', () => {
    setEditApprovalLatch('run-A');
    expect(isEditApprovalLatched('run-A')).toBe(true);
    expect(isEditApprovalLatched('run-B')).toBe(false);
    clearEditApprovalLatch('run-A');
  });

  it('settleConfirm with acceptAllRemaining propagates the flag in the resolved envelope', async () => {
    const promise = requestConfirm('approve and latch');
    expect(sentMessages).toHaveLength(1);
    const id = (sentMessages[0]?.payload as { id: string }).id;
    settleConfirm(id, { approved: true, acceptAllRemaining: true });
    // Audit fix H-04: envelope now carries a `reason` discriminator
    // (`'approved'` on user accept, `'denied'` on user reject, plus
    // host-side reasons for the fail-closed paths).
    await expect(promise).resolves.toEqual({
      approved: true,
      acceptAllRemaining: true,
      reason: 'approved'
    });
  });

  it('settleConfirm normalizes a bare boolean reply to the envelope', async () => {
    const promise = requestConfirm('legacy text confirm');
    const id = (sentMessages[0]?.payload as { id: string }).id;
    settleConfirm(id, false);
    // Audit fix H-04: bare-false reply normalizes to reason 'denied'.
    await expect(promise).resolves.toEqual({
      approved: false,
      acceptAllRemaining: false,
      reason: 'denied'
    });
  });
});
