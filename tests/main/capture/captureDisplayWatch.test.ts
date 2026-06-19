import { describe, expect, it, vi, beforeEach } from 'vitest';

const { on, invalidateCaptureSourceListCache } = vi.hoisted(() => ({
  on: vi.fn(),
  invalidateCaptureSourceListCache: vi.fn()
}));

vi.mock('electron', () => ({
  screen: { on }
}));

vi.mock('@main/capture/captureManager.js', () => ({
  invalidateCaptureSourceListCache
}));

describe('registerCaptureDisplayWatch', () => {
  beforeEach(() => {
    on.mockReset();
    invalidateCaptureSourceListCache.mockReset();
    vi.resetModules();
  });

  it('invalidates cache on display topology changes', async () => {
    const { registerCaptureDisplayWatch } = await import('@main/capture/captureDisplayWatch.js');
    registerCaptureDisplayWatch();
    expect(on).toHaveBeenCalledTimes(3);

    const added = on.mock.calls.find((call) => call[0] === 'display-added')?.[1] as () => void;
    expect(added).toBeTypeOf('function');
    added();
    expect(invalidateCaptureSourceListCache).toHaveBeenCalledTimes(1);
  });
});
