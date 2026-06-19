import type { CaptureSourceInfo } from '@shared/types/capture.js';
import { captureSourceKind, type CaptureSourceKind } from '@shared/capture/captureSourceKind.js';

export type { CaptureSourceKind };
export { captureSourceKind };

export interface GroupedCaptureSources {
  screens: CaptureSourceInfo[];
  windows: CaptureSourceInfo[];
}

/** Split desktopCapturer sources into displays vs application windows. */
export function groupCaptureSources(sources: CaptureSourceInfo[]): GroupedCaptureSources {
  const screens: CaptureSourceInfo[] = [];
  const windows: CaptureSourceInfo[] = [];
  for (const source of sources) {
    if (captureSourceKind(source.id) === 'screen') {
      screens.push(source);
    } else {
      windows.push(source);
    }
  }
  return { screens, windows };
}
