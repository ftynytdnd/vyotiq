/**
 * Regression tests for the `contextSummary:setMessageOverride` IPC
 * handler validator.
 *
 * Audit fix 2026-06-P2-1 originally guarded the `override` parameter
 * with `assertObject`, which incorrectly demanded a non-null object.
 * The wire shape is the string-literal union
 *
 *   `ContextMessageOverride = 'keep' | 'summarize' | 'drop'`
 *
 * (or `null` to clear), so every legitimate Inspector-row toggle from
 * `MessageRow.tsx` rejected with `override must be a non-null object`
 * — visible in `vyotiq.log` as four back-to-back
 *   `ipc/context-summary:set-message-override handler threw`
 * entries on a single user click. These tests pin the corrected
 * `assertEnum`-against-`CONTEXT_MESSAGE_OVERRIDES` validator so the
 * regression cannot recur, and lock the documented M1 corner-case
 * (`messageId === '*'` + non-null override) as a hard reject.
 */

import { describe, expect, it, vi, beforeEach, beforeAll } from 'vitest';
import { ipcMain } from 'electron';
import { IPC } from '@shared/constants';
import type { TimelineEvent } from '@shared/types/chat';

// `appendEvent` is the only persistence surface the handler reaches
// on the success path. Capture every call so the tests can assert
// the persisted `context-override-set` event has the expected shape.
const appended: Array<{ id: string; event: TimelineEvent }> = [];
vi.mock('@main/conversations/conversationStore', () => ({
  appendEvent: vi.fn(async (id: string, event: TimelineEvent) => {
    appended.push({ id, event });
  }),
  getConversationMeta: vi.fn(async () => null)
}));

// `applyOverrideEvent` is invoked AFTER the JSONL write succeeds.
// Stub it so the in-memory store doesn't accumulate state across
// tests; the success-path assertion focuses on the persisted shape.
const applyOverrideCalls: Array<{ id: string; event: unknown }> = [];
vi.mock('@main/orchestrator/contextSummarizer', () => ({
  applyOverrideEvent: vi.fn((id: string, event: unknown) => {
    applyOverrideCalls.push({ id, event });
    return true;
  }),
  getOverrides: vi.fn(() => Object.freeze({})),
  // The remaining symbols aren't reached by the handlers under test
  // but the IPC module pulls them in at import-time. Stub as no-ops.
  getInspectorSnapshot: vi.fn(() => null),
  replayOverrideEvents: vi.fn(),
  clearConversation: vi.fn()
}));

// The idle-summary runtime is imported at module-load but never
// reached by the setMessageOverride code path. Stub the surface
// the IPC module references so the import resolves cleanly.
vi.mock('@main/orchestrator/contextSummarizer/idleSummaryRuntime', () => ({
  getIdleActiveSummaryId: vi.fn(() => undefined),
  triggerIdleSummary: vi.fn(async () => ({
    ok: false,
    reason: 'not-reached-by-this-test'
  }))
}));

// `getMainWindow()` returning `null` short-circuits the optional
// snapshot-changed broadcast — exactly the path we want under test.
vi.mock('@main/window/getMainWindow', () => ({
  getMainWindow: () => null
}));

// Probe is only invoked from the idle-snapshot path — stub for
// import-resolution.
vi.mock('@main/harness/probeOverride', () => ({
  probeWorkspaceOverridePresent: vi.fn(async () => false)
}));

// Settings store is touched only by the rules handlers; the
// `setMessageOverride` handler never calls it. Stub so the import
// resolves without spinning up a real on-disk settings file.
vi.mock('@main/settings/settingsStore', () => ({
  getSettings: vi.fn(async () => ({})),
  setSettings: vi.fn(async () => ({}))
}));

import { registerContextSummaryIpc } from '@main/ipc/contextSummary.ipc';

interface MockIpcMain {
  __invoke: (channel: string, ...args: unknown[]) => unknown;
}

beforeAll(() => {
  registerContextSummaryIpc();
});

beforeEach(() => {
  appended.length = 0;
  applyOverrideCalls.length = 0;
});

describe('contextSummary:setMessageOverride validator', () => {
  it('accepts every `ContextMessageOverride` literal and persists the event', async () => {
    for (const override of ['keep', 'summarize', 'drop'] as const) {
      await expect(
        (ipcMain as unknown as MockIpcMain).__invoke(
          IPC.CONTEXT_SUMMARY_SET_MESSAGE_OVERRIDE,
          'conv-1',
          'msg-1',
          override
        )
      ).resolves.toBeUndefined();
    }
    // One persisted event per accepted literal, in order.
    expect(appended).toHaveLength(3);
    const overrides = appended.map((a) => {
      const ev = a.event as Extract<TimelineEvent, { kind: 'context-override-set' }>;
      return ev.override;
    });
    expect(overrides).toEqual(['keep', 'summarize', 'drop']);
    // Every persisted event uses the canonical kind + carries the
    // caller's messageId verbatim.
    for (const a of appended) {
      const ev = a.event as Extract<TimelineEvent, { kind: 'context-override-set' }>;
      expect(ev.kind).toBe('context-override-set');
      expect(ev.messageId).toBe('msg-1');
      expect(typeof ev.id).toBe('string');
      expect(typeof ev.ts).toBe('number');
    }
  });

  it('accepts `null` to clear an override', async () => {
    await expect(
      (ipcMain as unknown as MockIpcMain).__invoke(
        IPC.CONTEXT_SUMMARY_SET_MESSAGE_OVERRIDE,
        'conv-1',
        'msg-1',
        null
      )
    ).resolves.toBeUndefined();
    expect(appended).toHaveLength(1);
    const ev = appended[0]!.event as Extract<
      TimelineEvent,
      { kind: 'context-override-set' }
    >;
    expect(ev.override).toBeNull();
  });

  it('rejects an unknown override string with the allow-list preview', async () => {
    await expect(
      (ipcMain as unknown as MockIpcMain).__invoke(
        IPC.CONTEXT_SUMMARY_SET_MESSAGE_OVERRIDE,
        'conv-1',
        'msg-1',
        'archive'
      )
    ).rejects.toThrow(/one of: keep, summarize, drop/);
    // Validator runs BEFORE `appendEvent`, so a rejection means no
    // disk write fires.
    expect(appended).toHaveLength(0);
  });

  it('rejects an OBJECT override — the original audit-fix regression', async () => {
    // Pre-fix this branch was inverted: `assertObject` ACCEPTED the
    // object and rejected the string literal. After the fix the
    // validator routes through `assertEnum`, which rejects
    // non-strings with `must be a string` and rejects unknown
    // strings with the allow-list preview.
    await expect(
      (ipcMain as unknown as MockIpcMain).__invoke(
        IPC.CONTEXT_SUMMARY_SET_MESSAGE_OVERRIDE,
        'conv-1',
        'msg-1',
        { kind: 'keep' }
      )
    ).rejects.toThrow(/must be a string/);
    expect(appended).toHaveLength(0);
  });

  it('rejects a numeric override', async () => {
    await expect(
      (ipcMain as unknown as MockIpcMain).__invoke(
        IPC.CONTEXT_SUMMARY_SET_MESSAGE_OVERRIDE,
        'conv-1',
        'msg-1',
        42
      )
    ).rejects.toThrow(/must be a string/);
    expect(appended).toHaveLength(0);
  });

  it('rejects an empty messageId', async () => {
    await expect(
      (ipcMain as unknown as MockIpcMain).__invoke(
        IPC.CONTEXT_SUMMARY_SET_MESSAGE_OVERRIDE,
        'conv-1',
        '',
        'keep'
      )
    ).rejects.toThrow(/messageId must be a non-empty string/);
    expect(appended).toHaveLength(0);
  });

  it('rejects (messageId === "*", override !== null) per the M1 contract', async () => {
    // The dedicated `RESET_MESSAGE_OVERRIDES` IPC exists for the
    // clear-all path. Routing the reset-all sentinel through
    // `setMessageOverride` with a non-null value is a documented
    // caller bug (see the `overrideStore` doc-block).
    await expect(
      (ipcMain as unknown as MockIpcMain).__invoke(
        IPC.CONTEXT_SUMMARY_SET_MESSAGE_OVERRIDE,
        'conv-1',
        '*',
        'keep'
      )
    ).rejects.toThrow(/messageId="\*" requires override=null/);
    expect(appended).toHaveLength(0);
  });

  it('accepts (messageId === "*", override === null) — explicit reset-all sentinel', async () => {
    // The corner the M1 contract forbids is the (`'*'`, non-null)
    // pair. The (`'*'`, null) pair IS the canonical reset-all
    // sentinel and persists as a single override-set event with
    // messageId='*' so replay can reconstruct the cleared state.
    await expect(
      (ipcMain as unknown as MockIpcMain).__invoke(
        IPC.CONTEXT_SUMMARY_SET_MESSAGE_OVERRIDE,
        'conv-1',
        '*',
        null
      )
    ).resolves.toBeUndefined();
    expect(appended).toHaveLength(1);
    const ev = appended[0]!.event as Extract<
      TimelineEvent,
      { kind: 'context-override-set' }
    >;
    expect(ev.messageId).toBe('*');
    expect(ev.override).toBeNull();
  });

  it('rejects a non-string conversationId', async () => {
    await expect(
      (ipcMain as unknown as MockIpcMain).__invoke(
        IPC.CONTEXT_SUMMARY_SET_MESSAGE_OVERRIDE,
        42,
        'msg-1',
        'keep'
      )
    ).rejects.toThrow(/conversationId must be a string/);
    expect(appended).toHaveLength(0);
  });
});
