/**
 * Wire-up between provider tool-call args streams and the FS-aware
 * `DiffStreamer`. One pool of `PartialJsonParser` instances is held
 * keyed by `callId` so the partial JSON parse cost stays O(delta)
 * across the entire stream, mirroring the renderer-side parser pool
 * in `chatChannel.ts`.
 *
 * Lives in its own module so the integration is unit-testable in
 * isolation from the rest of `runOrchestratorLoop`. The orchestrator
 * loop is responsible for:
 *
 *   1. Calling `argsDeltaTap` from `handleAssistantTurn` /
 *      `handleDelegates` whenever a fresh `tool-call-args-delta`
 *      lands.
 *   2. Calling `onToolCallSettled` once the authoritative
 *      `tool-call` event has been emitted (so the streamer flips to
 *      settled mode and the parser is reclaimed).
 *   3. Calling `dispose()` at every loop exit (abort, halt, normal
 *      completion, error path) so the parser pool + the streamer's
 *      cached file bodies don't leak across long sessions.
 *
 * The streamer instance is injected so tests can swap in a fake
 * with the same surface.
 */

import { PartialJsonParser } from '@shared/text/partialJsonParser.js';
import type { DiffStreamer } from './diffStreamer.js';

export interface StreamingArgsTap {
  /**
   * Forward a fresh args-buffer snapshot for one in-flight tool
   * call. Names + sub-agent ids are passed through unchanged so the
   * streamer can scope its emit correctly.
   */
  argsDeltaTap: (
    callId: string,
    name: string | undefined,
    argsBuf: string,
    subagentId?: string
  ) => void;
  /**
   * Mark the call as settled. The streamer stops accepting late
   * deltas for this call; the parser entry is dropped so a slow
   * straggler doesn't pin memory.
   *
   * `owner` (`'orc'` or a `subagentId`) and `index` (the wire
   * position of the call inside the assistant turn) are forwarded
   * to `DiffStreamer.notifySettled` for surrogate-callId
   * reconciliation. When the provider transitioned `id` from
   * `undefined` to a real id mid-stream, the streamer may have
   * created a `pending:${owner}:${index}` `CallState` we still
   * need to drop here. `index` is optional — the streamer
   * fall-back is a lowest-index walk against the owner's prefix
   * (matches the renderer reducer's `clearPartialFor`).
   */
  onToolCallSettled: (callId: string, owner?: string, index?: number) => void;
  /**
   * Drop every per-call parser + every per-call streamer state.
   * Idempotent.
   */
  dispose: () => void;
}

/**
 * Build the streaming-args wire-up around an existing `DiffStreamer`.
 *
 * Args-buffer parsing is best-effort: a malformed stream causes the
 * parser entry to be dropped (no further deltas attempt to parse for
 * that call) and the snapshot is suppressed. The orchestrator loop
 * is never affected — failures here MUST stay local to the streaming
 * preview pipeline.
 */
export function createStreamingArgsTap(diffStreamer: DiffStreamer): StreamingArgsTap {
  const argsParsers = new Map<string, PartialJsonParser>();

  const argsDeltaTap: StreamingArgsTap['argsDeltaTap'] = (
    callId,
    name,
    argsBuf,
    subagentId
  ) => {
    if (!name) return;
    let parser = argsParsers.get(callId);
    if (!parser) {
      parser = new PartialJsonParser();
      argsParsers.set(callId, parser);
    }
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = parser.feed(argsBuf);
    } catch {
      // Parser already self-isolates errors; this catch is the
      // belt-and-suspenders fallback so a malformed stream can
      // never bring down the orchestrator loop.
      argsParsers.delete(callId);
      return;
    }
    diffStreamer.onArgsDelta({
      callId,
      name,
      parsed,
      ...(subagentId !== undefined ? { subagentId } : {})
    });
  };

  const onToolCallSettled: StreamingArgsTap['onToolCallSettled'] = (
    callId,
    owner,
    index
  ) => {
    diffStreamer.notifySettled(callId, owner, index);
    argsParsers.delete(callId);
    // Surrogate parser cleanup. Mirrors the streamer-side fold-in
    // above so the parser pool ends a long session at the same size
    // it started. When `index` is known, the lookup is exact;
    // otherwise we walk for the lowest-index surrogate matching the
    // owner — same logic as the streamer's surrogate walk.
    if (owner) {
      if (typeof index === 'number') {
        argsParsers.delete(`pending:${owner}:${index}`);
      } else {
        const prefix = `pending:${owner}:`;
        let lowestKey: string | null = null;
        let lowest = Number.POSITIVE_INFINITY;
        for (const key of argsParsers.keys()) {
          if (!key.startsWith(prefix)) continue;
          const idxN = Number(key.slice(prefix.length));
          if (Number.isFinite(idxN) && idxN < lowest) {
            lowest = idxN;
            lowestKey = key;
          }
        }
        if (lowestKey !== null) argsParsers.delete(lowestKey);
      }
    }
  };

  const dispose: StreamingArgsTap['dispose'] = () => {
    diffStreamer.dispose();
    argsParsers.clear();
  };

  return { argsDeltaTap, onToolCallSettled, dispose };
}
