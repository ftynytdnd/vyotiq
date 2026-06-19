import type { CaptureSourceInfo } from '@shared/types/capture.js';
import { captureSourceKind } from '@shared/capture/captureSourceKind.js';

/** Case-insensitive filter for capture picker search. */
export function filterCaptureSources(
  sources: CaptureSourceInfo[],
  query: string
): CaptureSourceInfo[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return sources;
  return sources.filter((source) => source.name.toLowerCase().includes(needle));
}

export function filterGroupedCaptureSources(
  screens: CaptureSourceInfo[],
  windows: CaptureSourceInfo[],
  query: string
): { screens: CaptureSourceInfo[]; windows: CaptureSourceInfo[] } {
  return {
    screens: filterCaptureSources(screens, query),
    windows: filterCaptureSources(windows, query)
  };
}

export function countCaptureCatalog(screens: CaptureSourceInfo[], windows: CaptureSourceInfo[]): number {
  return screens.length + windows.length;
}

export function isStaleCaptureSourceError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /no longer available|source not found|Capture source/i.test(msg);
}

export type CapturePickerNavRow =
  | { kind: 'app-window'; id: 'app-window' }
  | { kind: 'source'; id: string; sourceId: string };

export function buildCapturePickerNavRows(
  screens: CaptureSourceInfo[],
  windows: CaptureSourceInfo[]
): CapturePickerNavRow[] {
  const rows: CapturePickerNavRow[] = [{ kind: 'app-window', id: 'app-window' }];
  for (const source of screens) {
    rows.push({ kind: 'source', id: `screen:${source.id}`, sourceId: source.id });
  }
  for (const source of windows) {
    rows.push({ kind: 'source', id: `window:${source.id}`, sourceId: source.id });
  }
  return rows;
}

export function captureNavSubtitle(sourceId: string): string {
  return captureSourceKind(sourceId) === 'screen' ? 'Full display' : 'Application window';
}
