import { screen } from 'electron';
import { APP_NAME } from '@shared/constants.js';
import { redactCaptureWindowTitle } from './redactCaptureWindowTitle.js';

function enrichScreenName(name: string, sourceId: string): string {
  if (!sourceId.startsWith('screen:')) return name;
  const displays = screen.getAllDisplays();
  const parts = sourceId.split(':');
  const idx = Number.parseInt(parts[1] ?? '0', 10);
  const display = Number.isFinite(idx) ? displays[idx] : undefined;
  if (!display) return name;
  const label = display.label?.trim() || `Display ${idx + 1}`;
  const { width, height } = display.size;
  return `${label} — ${width}×${height}`;
}

/** Normalize desktopCapturer names for picker display. */
export function formatCaptureSourceDisplayName(
  name: string,
  sourceId: string,
  redactWindowTitles: boolean
): string {
  if (sourceId.startsWith('screen:')) {
    return enrichScreenName(name, sourceId);
  }
  return redactCaptureWindowTitle(name, redactWindowTitles);
}

/** Collapse duplicate Vyotiq window entries — keep the current app window when known. */
export function dedupeVyotiqWindowSources(
  sources: Array<{ id: string; name: string }>,
  appWindowSourceId: string | null
): Array<{ id: string; name: string }> {
  const vyotiqLike = (name: string) => name.toLowerCase().includes(APP_NAME.toLowerCase());
  let keptVyotiq = false;
  const out: Array<{ id: string; name: string }> = [];
  for (const source of sources) {
    if (!source.id.startsWith('window:')) {
      out.push(source);
      continue;
    }
    if (!vyotiqLike(source.name)) {
      out.push(source);
      continue;
    }
    if (appWindowSourceId && source.id === appWindowSourceId) {
      out.push(source);
      keptVyotiq = true;
      continue;
    }
    if (!keptVyotiq && !appWindowSourceId) {
      out.push(source);
      keptVyotiq = true;
    }
  }
  return out;
}
