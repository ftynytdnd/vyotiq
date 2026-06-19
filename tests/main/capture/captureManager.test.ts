import { describe, expect, it, vi, beforeEach } from 'vitest';

const getAllDisplays = vi.fn();

vi.mock('electron', () => ({
  desktopCapturer: { getSources: vi.fn() },
  nativeImage: { createFromBuffer: vi.fn() },
  screen: { getAllDisplays }
}));

vi.mock('@main/window/getMainWindow.js', () => ({
  getMainWindow: () => null
}));

vi.mock('@main/window/browserManager.js', () => ({
  browserCapturePage: vi.fn()
}));

vi.mock('@main/tools/sandbox.js', () => ({
  realpathInsideWorkspace: vi.fn(async (_root: string, rel: string) => rel)
}));

describe('maxCaptureThumbnailSize', () => {
  beforeEach(() => {
    getAllDisplays.mockReset();
  });

  it('uses the largest connected display up to 3840px', async () => {
    getAllDisplays.mockReturnValue([
      { size: { width: 1920, height: 1080 } },
      { size: { width: 2560, height: 1440 } }
    ]);
    const { maxCaptureThumbnailSize } = await import('@main/capture/captureManager.js');
    expect(maxCaptureThumbnailSize()).toEqual({ width: 2560, height: 1440 });
  });

  it('falls back to 1920×1080 when no displays are reported', async () => {
    getAllDisplays.mockReturnValue([]);
    const { maxCaptureThumbnailSize } = await import('@main/capture/captureManager.js');
    expect(maxCaptureThumbnailSize()).toEqual({ width: 1920, height: 1080 });
  });
});
