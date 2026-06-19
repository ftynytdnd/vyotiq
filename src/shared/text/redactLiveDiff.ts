/**
 * Redact sensitive strings in live diff telemetry before renderer paint.
 * Persist-time scrubbing stays in `redactPersistedEvent`; this module
 * covers ephemeral `diff-stream` frames and display-side tool args.
 */

import type { TimelineEvent } from '../types/chat.js';
import type { DiffHunk } from '../types/tool.js';
import { redactSensitiveText } from './redactSecretsInText.js';

/** Scrub every line in a hunk array for timeline display. */
export function redactDiffHunks(hunks: readonly DiffHunk[]): DiffHunk[] {
  return hunks.map((hunk) => ({
    ...hunk,
    lines: hunk.lines.map((line) => ({
      ...line,
      text: redactSensitiveText(line.text)
    }))
  }));
}

/** Deep-walk parsed tool args and redact string leaves only. */
export function redactParsedToolArgs(
  parsed: Record<string, unknown> | null
): Record<string, unknown> | null {
  if (!parsed) return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === 'string') {
      out[key] = redactSensitiveText(value);
    } else if (Array.isArray(value)) {
      out[key] = value.map((item) =>
        typeof item === 'string' ? redactSensitiveText(item) : item
      );
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Scrub ephemeral streaming events at the IPC boundary. Does not mutate
 * `tool-call-args-delta.argsBuf` — parsing happens on the raw buffer;
 * redacted snapshots are passed via `preParsedArgs` instead.
 */
export function redactTimelineEventForDisplay(event: TimelineEvent): TimelineEvent {
  if (event.kind === 'diff-stream') {
    return {
      ...event,
      hunks: redactDiffHunks(event.hunks),
      ...(event.postBody !== undefined
        ? { postBody: redactSensitiveText(event.postBody) }
        : {})
    };
  }
  return event;
}
