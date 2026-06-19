/**
 * Full-fidelity desktop capture via getUserMedia + desktopCapturer source id.
 */

export interface DesktopCaptureFrame {
  png: Uint8Array;
  width: number;
  height: number;
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

export async function captureDesktopSourceFrame(
  sourceId: string,
  signal?: AbortSignal
): Promise<DesktopCaptureFrame> {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const constraints = {
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: sourceId,
        maxWidth: 3840,
        maxHeight: 2160,
        maxFrameRate: 1
      }
    }
  } as unknown as MediaStreamConstraints;

  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  const abortListener = () => {
    for (const track of stream.getTracks()) {
      track.stop();
    }
  };
  signal?.addEventListener('abort', abortListener, { once: true });

  try {
    const video = document.createElement('video');
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
        signal?.addEventListener('abort', onAbort, { once: true });
        video.onloadeddata = () => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        };
      });
    }
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) {
      throw new Error('Capture stream returned no video dimensions.');
    }

    const dpr = window.devicePixelRatio || 1;
    const logicalW = window.screen.width;
    const logicalH = window.screen.height;
    const looksLogical =
      sourceId.startsWith('screen:') &&
      dpr > 1 &&
      width <= logicalW + 2 &&
      height <= logicalH + 2;

    const outWidth = looksLogical ? Math.round(width * dpr) : width;
    const outHeight = looksLogical ? Math.round(height * dpr) : height;

    const canvas = document.createElement('canvas');
    canvas.width = outWidth;
    canvas.height = outHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not create capture canvas.');
    ctx.drawImage(video, 0, 0, outWidth, outHeight);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encode failed'))), 'image/png');
    });
    const buf = new Uint8Array(await blob.arrayBuffer());
    return { png: buf, width: outWidth, height: outHeight };
  } catch (err) {
    if (isAbortError(err)) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    if (/not found|invalid|source/i.test(msg)) {
      throw new Error('Capture source is no longer available. Refresh the list and try again.');
    }
    throw err;
  } finally {
    signal?.removeEventListener('abort', abortListener);
    for (const track of stream.getTracks()) {
      track.stop();
    }
  }
}
