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
 *
 * Audit fix M-14: the original guard only checked that `kind` was a
 * non-empty string. A malformed `agent-text-delta` with missing
 * `id` / `delta` / `ts` therefore passed the guard and reached the
 * reducer, which indexed `state.assistantTexts[event.id]` — when
 * `event.id` was `undefined`, JavaScript coerced the key to the
 * literal string `'undefined'`, corrupting the assistant accumulator
 * for any subsequent legitimate event keyed on `'undefined'`.
 * Per-kind field validators below close that hole: every kind
 * verifies its required fields exist and have the right primitive
 * shape before being handed to the reducer. Unknown / new kinds
 * pass through with only the base sanity check (typed string `kind`,
 * `id`, `ts`) so additive evolution of the event union doesn't
 * silently drop new events.
 */

import type { TimelineEvent } from '@shared/types/chat.js';

function hasStringField(o: Record<string, unknown>, k: string): boolean {
  return typeof o[k] === 'string';
}

function hasNonEmptyStringField(o: Record<string, unknown>, k: string): boolean {
  const v = o[k];
  return typeof v === 'string' && v.length > 0;
}

function hasNumberField(o: Record<string, unknown>, k: string): boolean {
  return typeof o[k] === 'number';
}

/** Common base — every event has `kind`, `id`, `ts`. */
function hasBaseShape(o: Record<string, unknown>): boolean {
  return (
    hasNonEmptyStringField(o, 'kind') &&
    hasNonEmptyStringField(o, 'id') &&
    hasNumberField(o, 'ts')
  );
}

export function isTimelineEvent(value: unknown): value is TimelineEvent {
  if (typeof value !== 'object' || value === null) return false;
  const o = value as Record<string, unknown>;
  // Base shape — minimum every event carries.
  if (!hasBaseShape(o)) return false;
  const kind = o['kind'] as string;
  switch (kind) {
    // Streaming-text deltas. Bad shape here is the most damaging:
    // `id` is the accumulator key, `delta` is concatenated into the
    // running text. Missing either corrupts state.
    case 'agent-text-delta':
    case 'agent-reasoning-delta':
    case 'context-summary-delta':
    case 'context-summary-reasoning-delta':
      return hasStringField(o, 'delta');
    case 'agent-text-end':
    case 'agent-reasoning-end':
    case 'agent-text-aborted':
    case 'context-summary-end':
    case 'context-summary-aborted':
    case 'context-summary-undone':
    case 'context-summary-pending':
      // No additional required string content; base shape covers
      // `id` + `ts` + `kind`.
      return true;
    case 'user-prompt':
    case 'agent-thought':
    case 'phase':
    case 'error':
      // `content` (user-prompt / agent-thought) and `message` (error)
      // / `label` (phase) — every variant has a single text field.
      return (
        hasStringField(o, 'content') ||
        hasStringField(o, 'message') ||
        hasStringField(o, 'label')
      );
    case 'tool-call':
      return typeof o['call'] === 'object' && o['call'] !== null;
    case 'tool-result':
      return typeof o['result'] === 'object' && o['result'] !== null;
    case 'tool-call-args-delta':
      // Cumulative buffer; the renderer-side parser pool feeds on
      // `argsBuf`. Missing buffer would crash safeParsePartial.
      return (
        hasNonEmptyStringField(o, 'callId') &&
        hasStringField(o, 'argsBuf')
      );
    case 'subagent-pending':
    case 'subagent-spawn':
    case 'subagent-status':
    case 'subagent-result':
      return hasNonEmptyStringField(o, 'subagentId');
    case 'file-edit':
      return hasNonEmptyStringField(o, 'filePath');
    case 'token-usage':
      return typeof o['usage'] === 'object' && o['usage'] !== null;
    case 'run-status':
      return hasStringField(o, 'status') || hasStringField(o, 'label');
    case 'diff-stream':
      return hasNonEmptyStringField(o, 'callId');
    case 'checkpoint-entry':
    case 'checkpoint-revert':
    case 'checkpoint-bash-mutation':
      // Persisted audit-trail kinds — base shape is enough; the
      // checkpoint store does its own per-record validation.
      return true;
    case 'context-override-set':
      return hasNonEmptyStringField(o, 'messageId');
    default:
      // Unknown kind — the reducer's `never`-branch will route it to
      // the no-op default. Don't reject so future event kinds added
      // without an immediate guard update still flow through; the
      // reducer will simply ignore them rather than the guard
      // dropping them silently.
      return true;
  }
}
