import { APP_NAME } from '@shared/constants.js';
import type { CaptureSourceInfo } from '@shared/types/capture.js';
import { captureSourceKind, type CaptureSourceKind } from '@shared/capture/captureSourceKind.js';

export type { CaptureSourceKind };
export { captureSourceKind };

export interface GroupedCaptureSources {
  screens: CaptureSourceInfo[];
  windows: CaptureSourceInfo[];
}

function isVyotiqWindowSource(name: string): boolean {
  return name.toLowerCase().includes(APP_NAME.toLowerCase());
}

/** Split desktopCapturer sources into displays vs application windows. */
export function groupCaptureSources(sources: CaptureSourceInfo[]): GroupedCaptureSources {
  const screens: CaptureSourceInfo[] = [];
  const windows: CaptureSourceInfo[] = [];
  for (const source of sources) {
    if (captureSourceKind(source.id) === 'screen') {
      screens.push(source);
    } else if (!isVyotiqWindowSource(source.name)) {
      windows.push(source);
    }
  }
  return { screens, windows };
}