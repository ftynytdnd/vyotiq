/**
 * Thin helper for emitting `run-status` timeline events from anywhere in
 * the orchestrator. Centralizes the `id`/`ts` bookkeeping so call sites
 * read as a single intentful line.
 *
 * `run-status` events drive the renderer's `TurnStickyFooter` — the live
 * replacement for the old static "Agent V is thinking…" placeholder.
 * Every meaningful transition in the loop (contacting the provider,
 * awaiting the first token, running a tool, preparing the next turn,
 * delegating, verifying, nudging, retrying) emits one. The renderer
 * surfaces the most recent event plus a live wall-clock stopwatch
 * since it arrived.
 *
 * These events are intentionally NOT persisted to the JSONL transcript
 * (see `isPersistentEvent` in `chat.ipc.ts`) — they're pure live
 * telemetry, meaningless on replay.
 */

import { randomUUID } from 'node:crypto';
import type { RunStatusPhase, TimelineEvent } from '@shared/types/chat.js';

export type { RunStatusPhase };

export type RunStatusDetail = NonNullable<
  Extract<TimelineEvent, { kind: 'run-status' }>['detail']
>;

export function emitRunStatus(
  emit: (event: TimelineEvent) => void,
  phase: RunStatusPhase,
  label: string,
  detail?: RunStatusDetail
): void {
  emit({
    kind: 'run-status',
    id: randomUUID(),
    ts: Date.now(),
    phase,
    label,
    ...(detail ? { detail } : {})
  });
}
