/**
 * Renderer listener for main-process framebuffer requests (agent capture tool).
 */

import { useEffect } from 'react';
import type { CaptureFrameRequestEvent } from '@shared/types/capture.js';
import { vyotiq } from '../lib/ipc.js';
import { captureDesktopSourceFrame } from '../components/composer/captureDesktopStream.js';

export function useCaptureFrameBridge(): void {
  useEffect(() => {
    return vyotiq.capture.onRequestFrame((payload: CaptureFrameRequestEvent) => {
      void (async () => {
        try {
          const frame = await captureDesktopSourceFrame(payload.sourceId);
          await vyotiq.capture.submitFrameResult({
            requestId: payload.requestId,
            ok: true,
            png: frame.png,
            width: frame.width,
            height: frame.height
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Capture failed.';
          await vyotiq.capture.submitFrameResult({
            requestId: payload.requestId,
            ok: false,
            error: msg
          });
        }
      })();
    });
  }, []);
}
