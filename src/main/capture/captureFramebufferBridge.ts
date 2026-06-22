/**
 * Request full-fidelity desktop frames from the renderer getUserMedia path.
 * Used by the agent `capture` tool so main and composer share one pipeline.
 */

import { randomUUID } from 'node:crypto';
import { IPC } from '@shared/constants.js';
import { getMainWindow } from '../window/getMainWindow.js';
import { safeWebContentsSend } from '../window/safeWebContentsSend.js';
import { logger } from '../logging/logger.js';

const log = logger.child('capture/frame-bridge');
void log;

const CAPTURE_FRAME_TIMEOUT_MS = 30_000;

interface PendingFrame {
  resolve: (value: { png: Buffer; width: number; height: number }) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  cleanup: () => void;
}

const pending = new Map<string, PendingFrame>();

export function settleCaptureFrameResult(input: {
  requestId: string;
  ok: boolean;
  png?: Uint8Array;
  width?: number;
  height?: number;
  error?: string;
}): void {
  const entry = pending.get(input.requestId);
  if (!entry) return;
  pending.delete(input.requestId);
  clearTimeout(entry.timer);
  entry.cleanup();

  if (input.ok && input.png && input.width && input.height) {
    entry.resolve({
      png: Buffer.from(input.png),
      width: input.width,
      height: input.height
    });
    return;
  }
  entry.reject(new Error(input.error ?? 'Screen capture failed.'));
}

export function requestCaptureFramebuffer(
  sourceId: string,
  signal?: AbortSignal
): Promise<{ png: Buffer; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) {
      reject(new Error('Renderer is not available for screen capture.'));
      return;
    }

    const requestId = randomUUID();
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error('Screen capture timed out.'));
    }, CAPTURE_FRAME_TIMEOUT_MS);

    const cleanupAbort = () => {
      signal?.removeEventListener('abort', onAbort);
    };

    const onAbort = () => {
      pending.delete(requestId);
      clearTimeout(timer);
      cleanupAbort();
      reject(new DOMException('Aborted', 'AbortError'));
    };

    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });

    pending.set(requestId, {
      resolve: (value) => {
        cleanupAbort();
        resolve(value);
      },
      reject: (err) => {
        cleanupAbort();
        reject(err);
      },
      timer,
      cleanup: cleanupAbort
    });

    if (!safeWebContentsSend(IPC.CAPTURE_REQUEST_FRAME, { requestId, sourceId })) {
      pending.delete(requestId);
      clearTimeout(timer);
      cleanupAbort();
      reject(new Error('Renderer is not available for screen capture.'));
    }
  });
}

/** Reject in-flight capture requests and clear timers on app quit. */
export function teardownCaptureFramebufferBridge(): void {
  for (const [requestId, entry] of pending) {
    pending.delete(requestId);
    clearTimeout(entry.timer);
    entry.cleanup();
    entry.reject(new Error('Application is shutting down.'));
  }
}
