import type { CaptureSourceInfo } from '../types/capture.js';
import { captureSourceKind } from './captureSourceKind.js';

/** Sort displays by id; windows alphabetically with optional foreground id first. */
export function sortCaptureSources(
  sources: CaptureSourceInfo[],
  foregroundWindowSourceId?: string | null
): CaptureSourceInfo[] {
  const screens: CaptureSourceInfo[] = [];
  const windows: CaptureSourceInfo[] = [];
  for (const source of sources) {
    if (captureSourceKind(source.id) === 'screen') screens.push(source);
    else windows.push(source);
  }

  screens.sort((a, b) => a.id.localeCompare(b.id));

  windows.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  if (foregroundWindowSourceId) {
    const idx = windows.findIndex((w) => w.id === foregroundWindowSourceId);
    if (idx > 0) {
      const [fg] = windows.splice(idx, 1);
      if (fg) windows.unshift(fg);
    }
  }

  return [...screens, ...windows];
}
