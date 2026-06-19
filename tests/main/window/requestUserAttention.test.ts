import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const focus = vi.fn();
const restore = vi.fn();
const flashFrame = vi.fn();
const isFocused = vi.fn(() => false);
const isMinimized = vi.fn(() => false);
const isDestroyed = vi.fn(() => false);

vi.mock('electron', () => ({
  app: { focus: vi.fn() },
  BrowserWindow: {
    getAllWindows: vi.fn(() => [
      {
        isDestroyed,
        isMinimized,
        isFocused,
        restore,
        focus,
        flashFrame
      }
    ])
  }
}));

vi.mock('@main/window/getMainWindow.js', () => ({
  getMainWindow: () => ({
    isDestroyed,
    isMinimized,
    isFocused,
    restore,
    focus,
    flashFrame
  })
}));

describe('requestUserAttention', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    focus.mockClear();
    restore.mockClear();
    flashFrame.mockClear();
    isFocused.mockReturnValue(false);
    isMinimized.mockReturnValue(false);
  });

  afterEach(async () => {
    const mod = await import('@main/window/requestUserAttention.js');
    mod.__test_resetUserAttention();
    vi.useRealTimers();
  });

  it('focuses the main window when not already focused', async () => {
    const { requestUserAttention } = await import('@main/window/requestUserAttention.js');
    requestUserAttention('ask-user');
    vi.runAllTimers();
    expect(restore).not.toHaveBeenCalled();
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('debounces repeated calls for the same reason', async () => {
    const { requestUserAttention } = await import('@main/window/requestUserAttention.js');
    requestUserAttention('run-settled');
    requestUserAttention('run-settled');
    vi.runAllTimers();
    expect(focus).toHaveBeenCalledTimes(1);
  });
});
