/**
 * Resolve the live bash output snapshot for the command currently running.
 */

import type { TimelineEvent } from '@shared/types/chat.js';
import type { LiveToolOutputSnapshot } from '../reducer/types.js';
import { isTimelineHiddenTool } from './timelineHiddenTools.js';

export function resolveActiveBashLiveOutput(input: {
  events: TimelineEvent[];
  liveToolOutputByCallId: Record<string, LiveToolOutputSnapshot>;
  toolResultSettledIds: Record<string, true>;
}): LiveToolOutputSnapshot | null {
  if (Object.keys(input.liveToolOutputByCallId).length === 0) return null;

  for (let i = input.events.length - 1; i >= 0; i--) {
    const event = input.events[i]!;
    if (event.kind === 'tool-result') continue;
    if (event.kind !== 'tool-call') continue;
    if (event.call.name !== 'bash' || isTimelineHiddenTool(event.call.name)) continue;
    if (input.toolResultSettledIds[event.call.id]) continue;
    return input.liveToolOutputByCallId[event.call.id] ?? null;
  }

  return null;
}

export function tailLine(text: string, max = 72): string {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.length > 0);
  const last = lines[lines.length - 1] ?? '';
  if (last.length <= max) return last;
  return `…${last.slice(-(max - 1))}`;
}
