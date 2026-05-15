/**
 * Runtime guards for IPC payloads heading into the timeline reducer.
 *
 * The IPC boundary is trusted in principle, but a bug in the main
 * process could in theory produce a payload that doesn't match
 * `TimelineEvent`. The reducer's exhaustive `never`-branch would crash
 * on such a value; these guards let `chatChannel` drop and log the
 * malformed event instead of taking the timeline down.
 *
 * Lives next to the reducer (and not inside `Timeline.tsx`) because
 * non-UI callers (e.g. `chatChannel.ts`) need to import it without
 * pulling in the React tree.
 */

import type { TimelineEvent } from '@shared/types/chat.js';

export function isTimelineEvent(value: unknown): value is TimelineEvent {
  if (typeof value !== 'object' || value === null) return false;
  const kind = (value as Record<string, unknown>)['kind'];
  return typeof kind === 'string' && kind.length > 0;
}
