/**
 * `safeCopy` helper tests.
 *
 * Coverage (Review fix N-02):
 *   - Writes through `navigator.clipboard.writeText` and returns
 *     `true` on success without surfacing a toast.
 *   - Returns `false` on Clipboard-API rejection AND surfaces a
 *     danger toast — pre-fix every renderer copy site lost the
 *     rejection into an unhandled-promise warning, leaving the user
 *     with no feedback when "Copy" silently failed.
 *   - Empty-string fast path returns `false` without invoking the
 *     Clipboard API or showing a toast (defensive: callers already
 *     guard but the helper's own contract should be honest).
 *   - `toastOnFailure: false` suppresses the danger toast for
 *     diagnostic / programmatic copy paths.
 *   - `document.execCommand` fallback covers environments without
 *     the Clipboard API.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { safeCopy } from '@renderer/lib/clipboard';
import { useToastStore } from '@renderer/store/useToastStore';

const PRISTINE_TOASTS = useToastStore.getState();
function resetToasts() {
  useToastStore.setState(PRISTINE_TOASTS, /* replace */ true);
}

/**
 * Re-install a Clipboard-API mock on `navigator.clipboard` for each
 * case. happy-dom does not implement the writeText surface by
 * default, so we polyfill explicitly. Each test can override
 * `writeText` via `vi.spyOn`.
 */
function installClipboardMock() {
  const stub = { writeText: vi.fn(async () => undefined) };
  Object.defineProperty(navigator, 'clipboard', {
    value: stub,
    configurable: true,
    writable: true
  });
  return stub;
}

describe('safeCopy', () => {
  beforeEach(() => {
    resetToasts();
    vi.restoreAllMocks();
  });

  it('writes through navigator.clipboard.writeText and returns true', async () => {
    const clipboard = installClipboardMock();
    const ok = await safeCopy('hello', { context: 'unit' });
    expect(ok).toBe(true);
    expect(clipboard.writeText).toHaveBeenCalledWith('hello');
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('returns false and shows a danger toast on Clipboard-API rejection', async () => {
    const clipboard = installClipboardMock();
    clipboard.writeText.mockRejectedValueOnce(new Error('permission denied'));

    const ok = await safeCopy('hello', { context: 'unit' });

    expect(ok).toBe(false);
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.tone).toBe('danger');
    expect(toasts[0]?.message).toContain('permission denied');
  });

  it('returns false without invoking the Clipboard API for empty strings', async () => {
    const clipboard = installClipboardMock();
    const ok = await safeCopy('', { context: 'unit' });
    expect(ok).toBe(false);
    expect(clipboard.writeText).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('toastOnFailure:false suppresses the danger toast on rejection', async () => {
    const clipboard = installClipboardMock();
    clipboard.writeText.mockRejectedValueOnce(new Error('locked'));

    const ok = await safeCopy('hello', { toastOnFailure: false });

    expect(ok).toBe(false);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('falls back to document.execCommand when Clipboard API is missing', async () => {
    // Strip the Clipboard API for this test. The helper must then
    // route through the textarea + execCommand legacy path. happy-
    // dom does not implement `document.execCommand` by default, so
    // we install a stub directly via `defineProperty` (a `vi.spyOn`
    // would throw "property not defined on the object").
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
      writable: true
    });
    const execStub = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', {
      value: execStub,
      configurable: true,
      writable: true
    });

    const ok = await safeCopy('hello', { context: 'fallback' });

    expect(ok).toBe(true);
    expect(execStub).toHaveBeenCalledWith('copy');
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('reports failure via toast when both Clipboard API AND execCommand are unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
      writable: true
    });
    Object.defineProperty(document, 'execCommand', {
      value: vi.fn(() => false),
      configurable: true,
      writable: true
    });

    const ok = await safeCopy('hello');

    expect(ok).toBe(false);
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.tone).toBe('danger');
    expect(toasts[0]?.message.toLowerCase()).toContain('clipboard');
  });
});
