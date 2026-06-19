import { describe, expect, it, vi, beforeEach } from 'vitest';
import { settleCaptureFrameResult, requestCaptureFramebuffer } from '@main/capture/captureFramebufferBridge.js';

const send = vi.fn();

vi.mock('@main/window/getMainWindow.js', () => ({
  getMainWindow: () => ({ isDestroyed: () => false })
}));

vi.mock('@main/window/safeWebContentsSend.js', () => ({
  safeWebContentsSend: (...args: unknown[]) => send(...args)
}));

describe('captureFramebufferBridge', () => {
  beforeEach(() => {
    send.mockReset();
    send.mockReturnValue(true);
  });

  it('resolves pending requests when frame result arrives', async () => {
    send.mockImplementation((_channel: string, payload: { requestId: string }) => {
      settleCaptureFrameResult({
        requestId: payload.requestId,
        ok: true,
        png: new Uint8Array([1, 2, 3]),
        width: 10,
        height: 8
      });
    });

    const frame = await requestCaptureFramebuffer('screen:0:0');
    expect(frame.width).toBe(10);
    expect(frame.height).toBe(8);
    expect(frame.png).toEqual(Buffer.from([1, 2, 3]));
  });

  it('rejects when renderer send fails', async () => {
    send.mockReturnValue(false);
    await expect(requestCaptureFramebuffer('screen:0:0')).rejects.toThrow(
      /Renderer is not available/
    );
  });
});
