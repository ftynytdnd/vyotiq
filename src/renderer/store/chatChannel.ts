/**
 * Chat channel bootstrap. Wires the live IPC stream (`chat:event`,
 * `chat:done`, `chat:error`) to the chat store's reducer actions.
 *
 * Invoked ONCE from `main.tsx`. A global HMR guard ensures listeners are
 * not duplicated across hot reloads.
 *
 * Phase 1.1 — partial-JSON parser pool:
 *   The orchestrator emits `tool-call-args-delta` events at provider
 *   speed (dozens per second for a long `edit.newString`). The reducer's
 *   `tool-call-args-delta` branch parses the cumulative buffer into the
 *   best-effort `Record<string, unknown>` snapshot the renderer paints.
 *   Re-instantiating a fresh `safeParsePartial` parser per delta is
 *   O(n²) over the stream — exactly the anti-pattern the
 *   `PartialJsonParser` was designed to avoid.
 *
 *   This module keeps a long-lived `PartialJsonParser` per
 *   `(runId, callId)` pair. Each delta feeds the cumulative buffer
 *   into the matching parser (O(delta) per call) and the resulting
 *   snapshot is passed alongside the dispatch via
 *   `applyEvent(runId, event, { preParsedArgs })`. Pool entries are
 *   dropped when the authoritative `tool-call` event lands, when the
 *   run aborts (`agent-text-aborted`), and when the run terminates
 *   (`chat:done` / `chat:error`). HMR teardown clears the entire pool.
 */

import type { TimelineEvent } from '@shared/types/chat.js';
import { vyotiq } from '../lib/ipc.js';
import { useChatStore } from './useChatStore.js';
import { isTimelineEvent } from '../components/timeline/reducer/runtimeGuards.js';
import { createRafBatcher } from '../lib/rafBatch.js';
import { logger } from '../lib/logger.js';
import { PartialJsonParser } from '@shared/text/partialJsonParser.js';

const log = logger.child('chatChannel');

interface ChannelGlobals {
  __vyotiqChatChannelUnsub?: Array<() => void>;
}
const globalsRef = globalThis as unknown as ChannelGlobals;

/**
 * Buffered queue entry for a `tool-call-args-delta` event waiting to be
 * flushed into the store on the next animation frame. Carries the
 * full event + runId so the eventual `applyEvent` call retains its
 * normal routing path (per-conversation slice dispatch).
 */
interface ArgsDeltaQueueEntry {
  runId: string;
  event: Extract<TimelineEvent, { kind: 'tool-call-args-delta' }>;
}

/**
 * Per-`(runId, id, kind)` accumulator for streaming text + reasoning
 * deltas. Pre-fix, every provider token (`agent-text-delta` /
 * `agent-reasoning-delta`) called `useChatStore.applyEvent`
 * synchronously, which in turn triggered a React render. A 4 000-
 * token answer therefore produced ~4 000 commits per turn — the
 * fundamental cause of the streaming jank visible in screenshot 1.
 *
 * Audit fix A3: RAF-coalesce deltas for the same `(runId, id, kind)`
 * tuple within a single animation frame and dispatch ONE combined
 * event with the concatenated `delta` payload. The reducer already
 * sums per delta (`text + event.delta`), so N deltas of one char
 * each are functionally identical to one delta of N chars on the
 * UI side; only the React-render churn changes.
 *
 * The transport layer still emits per-token deltas (so the wire
 * timing reflects real provider pacing for any future inspector),
 * and the per-token persistence coalescer in `chat.ipc.ts`
 * continues to operate independently on the main side. This batcher
 * is renderer-only.
 *
 * Boundary handling — any of these events MUST flush all matching
 * pending deltas synchronously BEFORE dispatching themselves so the
 * order stays causal (`deltas → boundary`):
 *   - `agent-text-end` / `agent-reasoning-end` for the same id.
 *   - `agent-text-aborted` for the same id (drops both text AND
 *     reasoning accumulators — mirrors the reducer).
 *   - Any NON-delta event (tool-call, phase, …) flushes ALL pending
 *     entries for the same runId — matches the main-side
 *     implicit-boundary rule in `chat.ipc.ts:emit` and keeps the
 *     replay-order invariant ("deltas always precede their
 *     boundary") honored on the live path too.
 */
interface TextDeltaAccumulator {
  runId: string;
  /** First-seen delta drives the synthesized event's `ts`. */
  firstEvent: Extract<
    TimelineEvent,
    { kind: 'agent-text-delta' | 'agent-reasoning-delta' }
  >;
  /** Accumulated `delta` text since the last flush. */
  buf: string;
}

const TEXT_BATCH_SEP = '\u0000';

function textBatchKey(
  runId: string,
  id: string,
  kind: 'agent-text-delta' | 'agent-reasoning-delta'
): string {
  return `${runId}${TEXT_BATCH_SEP}${id}${TEXT_BATCH_SEP}${kind}`;
}

/**
 * Module-scoped text/reasoning-delta accumulator pool. Mirrors the
 * `parserPool` shape so the test surface can assert on its size +
 * keys across HMR. The pool is wiped on every `bootstrapChatChannel`
 * call (HMR guard + initial boot) and on channel teardown.
 *
 * State stays at module scope rather than inside `bootstrapChatChannel`
 * so `__vyotiqChatChannelInternal` can expose introspection hooks for
 * tests without breaking the IIFE encapsulation contract.
 */
const textDeltaAccumulators = new Map<string, TextDeltaAccumulator>();

/**
 * Per-`(runId, callId)` parser pool. Keys are `${runId}\u0000${callId}`
 * so the same callId in two concurrent runs doesn't collide. The pool
 * size grows by one per in-flight tool call and shrinks again on
 * `tool-call` reconciliation, abort, or run termination.
 */
const parserPool = new Map<string, PartialJsonParser>();

const PARSER_KEY_SEP = '\u0000';

function parserKey(runId: string, callId: string): string {
  return `${runId}${PARSER_KEY_SEP}${callId}`;
}

/** Drop one parser by `(runId, callId)`. No-op when missing. */
function dropParser(runId: string, callId: string): void {
  parserPool.delete(parserKey(runId, callId));
}

/** Drop every parser for a run. Used on terminal `done` / `error`. */
function dropAllParsersForRun(runId: string): void {
  const prefix = `${runId}${PARSER_KEY_SEP}`;
  for (const key of parserPool.keys()) {
    if (key.startsWith(prefix)) parserPool.delete(key);
  }
}

/**
 * Feed one delta into the matching long-lived parser and return the
 * cumulative snapshot. Creates the parser on first use. Defensive:
 * a feed throw is caught (the parser already does this internally,
 * but we belt-and-suspenders so a malformed stream can never tear
 * down the IPC listener).
 */
function feedParser(
  runId: string,
  event: Extract<TimelineEvent, { kind: 'tool-call-args-delta' }>
): Record<string, unknown> | null {
  const key = parserKey(runId, event.callId);
  let parser = parserPool.get(key);
  if (!parser) {
    parser = new PartialJsonParser();
    parserPool.set(key, parser);
  }
  try {
    return parser.feed(event.argsBuf);
  } catch (err) {
    log.warn('parser pool: feed threw — dropping parser', {
      runId,
      callId: event.callId,
      err
    });
    parserPool.delete(key);
    return null;
  }
}

/**
 * Surrogate-callId reconciliation, mirroring the reducer's
 * `clearPartialFor`: when an authoritative `tool-call` lands without
 * a real callId match in the pool, the orchestrator/sub-agent
 * settled the lowest-index `pending:<owner>:<index>` surrogate.
 * We drop that surrogate here so the next delta on the new real id
 * starts with a fresh parser.
 */
function reconcileToolCallParser(
  runId: string,
  realCallId: string,
  owner: string
): void {
  // Direct-match path: the tool-call landed on its real callId and
  // a parser already exists for it. Route through `dropParser` so
  // the by-(runId, callId) drop has a single named code path —
  // surrogate-walks below still need raw `parserPool.delete(key)`
  // because they iterate already-computed pool keys, but the
  // direct hit is the natural caller for the helper.
  if (parserPool.has(parserKey(runId, realCallId))) {
    dropParser(runId, realCallId);
    return;
  }
  // Walk surrogates for this owner under this run. The runtime
  // processes settled tool calls in index order, so the lowest-index
  // surrogate is the one that matches.
  const surrogatePrefix = `${runId}${PARSER_KEY_SEP}pending:${owner}:`;
  let lowestKey: string | null = null;
  let lowestIndex = Number.POSITIVE_INFINITY;
  for (const key of parserPool.keys()) {
    if (!key.startsWith(surrogatePrefix)) continue;
    const idxRaw = key.slice(surrogatePrefix.length);
    const idx = Number(idxRaw);
    if (Number.isFinite(idx) && idx < lowestIndex) {
      lowestIndex = idx;
      lowestKey = key;
    }
  }
  if (lowestKey !== null) parserPool.delete(lowestKey);
}

export function bootstrapChatChannel(): void {
  if (typeof window === 'undefined' || !window.vyotiq) return;

  // Tear down any previous subscriptions (HMR).
  if (Array.isArray(globalsRef.__vyotiqChatChannelUnsub)) {
    for (const fn of globalsRef.__vyotiqChatChannelUnsub) {
      try { fn(); } catch { /* noop */ }
    }
    // Wipe the parser pool too — the previous boot's parsers reference
    // closures from the prior module instance and would leak otherwise.
    parserPool.clear();
  }

  const unsub: Array<() => void> = [];

  // Audit fix A3: text/reasoning-delta accumulator state. The map
  // itself lives at module scope (see `textDeltaAccumulators`
  // above) so the test surface can introspect it; we just hold
  // the RAF handle locally so HMR teardown can cancel cleanly.
  let textDeltaRafHandle: number | null = null;
  // Wipe any residual entries from a prior bootstrap pass. The
  // global guard above already removed listeners, but a residual
  // entry would otherwise be charged to the new boot's first
  // emitted delta.
  textDeltaAccumulators.clear();
  const rafSchedule: (cb: FrameRequestCallback) => number =
    typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (cb) => {
        // Test / SSR fallback identical to `rafBatch.ts`'s pickScheduler.
        queueMicrotask(() => cb(performance.now?.() ?? Date.now()));
        return 1;
      };
  const rafCancel: (h: number) => void =
    typeof cancelAnimationFrame === 'function'
      ? cancelAnimationFrame
      : () => { /* microtasks can't be cancelled */ };

  /**
   * Dispatch the accumulated delta for one accumulator entry. The
   * synthesized event preserves the FIRST delta's `ts` + `subagentId`
   * — matches what the reducer would have seen had the deltas
   * landed individually (the first delta is what opens the
   * renderer accumulator and stamps `startedAt`).
   *
   * `buf` is reset to `''` rather than the entry being deleted so
   * a subsequent delta on the same key can keep streaming without
   * needing to re-seed the first-event metadata. The caller decides
   * when to delete the entry (boundary events do; the RAF drain
   * does once `buf` is empty post-flush).
   */
  const flushTextEntry = (entry: TextDeltaAccumulator): void => {
    if (entry.buf.length === 0) return;
    const merged = { ...entry.firstEvent, delta: entry.buf } as TimelineEvent;
    try {
      useChatStore.getState().applyEvent(entry.runId, merged);
    } catch (err) {
      log.warn('text-delta merged dispatch threw', { runId: entry.runId, err });
    }
    entry.buf = '';
  };

  /**
   * Flush + drop every pending text/reasoning entry for `runId`.
   * Called before any non-delta event for the same run lands so
   * the order stays `…deltas → next-event`. Matches the implicit-
   * boundary rule the main-side persistence coalescer applies in
   * `chat.ipc.ts`.
   */
  const flushAllTextForRun = (runId: string): void => {
    if (textDeltaAccumulators.size === 0) return;
    const prefix = `${runId}${TEXT_BATCH_SEP}`;
    for (const [k, entry] of textDeltaAccumulators) {
      if (!k.startsWith(prefix)) continue;
      flushTextEntry(entry);
      textDeltaAccumulators.delete(k);
    }
  };

  /** Flush a single `(runId, id)` pair across both kinds (text +
   *  reasoning). Used by `agent-text-end` / `agent-text-aborted`
   *  / `agent-reasoning-end`. */
  const flushTextForId = (runId: string, id: string): void => {
    for (const kind of ['agent-text-delta', 'agent-reasoning-delta'] as const) {
      const key = textBatchKey(runId, id, kind);
      const entry = textDeltaAccumulators.get(key);
      if (!entry) continue;
      flushTextEntry(entry);
      textDeltaAccumulators.delete(key);
    }
  };

  const drainTextDeltas = () => {
    textDeltaRafHandle = null;
    if (textDeltaAccumulators.size === 0) return;
    for (const [k, entry] of textDeltaAccumulators) {
      flushTextEntry(entry);
      // Keep the entry around with an empty `buf` so the next delta
      // on the same key skips the metadata-seed branch. Boundary
      // events explicitly delete entries; we trim long-idle ones
      // by GC on the next boundary or run-end.
      if (entry.buf.length === 0) {
        // Only retain if we expect more deltas — once the buf is
        // empty AND no new delta has arrived, the next delta will
        // re-seed cheaply, so dropping is fine. Net effect is the
        // same; keeps the map small under bursty long streams.
        textDeltaAccumulators.delete(k);
      }
    }
  };

  const scheduleTextDrain = (): void => {
    if (textDeltaRafHandle !== null) return;
    textDeltaRafHandle = rafSchedule(drainTextDeltas);
  };

  /**
   * Enqueue one text/reasoning delta. Creates the accumulator on
   * first sight; subsequent deltas just append to `buf`. The first
   * scheduling request flips `textDeltaRafHandle` so we get at
   * most one frame callback per `(runId, id, kind)` family.
   */
  const enqueueTextDelta = (
    runId: string,
    event: Extract<
      TimelineEvent,
      { kind: 'agent-text-delta' | 'agent-reasoning-delta' }
    >
  ): void => {
    const key = textBatchKey(runId, event.id, event.kind);
    const existing = textDeltaAccumulators.get(key);
    if (existing) {
      existing.buf += event.delta;
    } else {
      textDeltaAccumulators.set(key, {
        runId,
        firstEvent: event,
        buf: event.delta
      });
    }
    scheduleTextDrain();
  };

  // RAF-batched drain for `tool-call-args-delta` events. The
  // orchestrator emits these at provider speed (dozens per second
  // for a long `edit.newString`); we coalesce all entries arriving
  // within a single animation frame and dispatch the LAST one per
  // (runId, callId) so React sees at most one `setState` per frame.
  //
  // Why latest-only: every delta carries the cumulative `argsBuf`
  // (see `TimelineEvent['tool-call-args-delta'].argsBuf`), so an
  // earlier entry is always a strict prefix of a later one — no
  // information is lost by collapsing.
  //
  // Pattern: "Streaming Backends & React" (sitepoint.com, 2026).
  const argsDeltaBatcher = createRafBatcher<ArgsDeltaQueueEntry>((batch) => {
    // Collapse to the latest per (runId, callId).
    const latest = new Map<string, ArgsDeltaQueueEntry>();
    for (const entry of batch) {
      const key = `${entry.runId}\u0000${entry.event.callId}`;
      latest.set(key, entry);
    }
    const store = useChatStore.getState();
    for (const entry of latest.values()) {
      try {
        // Phase 1.1: pre-parse the cumulative buffer through the
        // long-lived per-callId parser so the reducer skips its own
        // one-shot `safeParsePartial`. The parser carries `lastIndex`
        // forward across feeds so each call costs O(delta) instead
        // of O(buf).
        const preParsedArgs = feedParser(entry.runId, entry.event);
        store.applyEvent(entry.runId, entry.event, { preParsedArgs });
      } catch (err) {
        log.warn('args-delta drain threw', { runId: entry.runId, err });
      }
    }
  });

  // Every listener body is wrapped in try/catch. A throw from the
  // reducer (malformed event slipping past the runtime guard, an
  // unhandled selector case, etc.) previously tore down the IPC
  // listener for the rest of the renderer's lifetime — every
  // subsequent run silently "looked frozen" until a full reload.
  // We trade that for a logged warning and a live timeline.
  unsub.push(
    vyotiq.chat.onEvent((runId, event) => {
      try {
        // Defensive runtime validation: the IPC boundary is trusted, but a
        // bugged main-process path could in theory send a malformed payload
        // that would crash the reducer's exhaustive never-branch. Drop and
        // log instead of exploding the timeline.
        if (!isTimelineEvent(event)) {
          log.warn('dropping malformed timeline event', { runId, event });
          return;
        }
        // Route streaming partial-args deltas through the RAF
        // batcher so a high-frequency stream produces at most one
        // store update per frame. All other event kinds dispatch
        // immediately — they're already throttled by the provider
        // and a small handful per second is well within React's
        // happy-path render budget.
        if (event.kind === 'tool-call-args-delta') {
          argsDeltaBatcher.push({ runId, event });
          return;
        }
        // Audit fix A3: RAF-coalesce streaming text + reasoning
        // deltas the same way args-deltas are coalesced. The
        // reducer's accumulation semantics (`text + event.delta`)
        // make merging N deltas-of-1-char into one delta-of-N
        // semantically identical, so we cut React renders from
        // O(tokens) to O(frames). Boundary events below flush
        // pending entries BEFORE their own dispatch so the
        // order stays causal.
        if (
          event.kind === 'agent-text-delta' ||
          event.kind === 'agent-reasoning-delta'
        ) {
          enqueueTextDelta(runId, event);
          return;
        }
        // Boundary handling: any of these MUST flush pending text/
        // reasoning deltas BEFORE the boundary event dispatches.
        // Without this, the renderer reducer would see
        // `*-end → leftover delta` and the leftover delta would
        // re-open a "settled" accumulator.
        if (
          event.kind === 'agent-text-end' ||
          event.kind === 'agent-reasoning-end' ||
          event.kind === 'agent-text-aborted'
        ) {
          flushTextForId(runId, event.id);
        } else {
          // Any other event kind is an implicit boundary for ALL
          // in-flight text/reasoning streams in this run. Matches
          // the main-side coalescer's implicit-boundary rule.
          flushAllTextForRun(runId);
        }
        // Phase 1.1: prune the parser pool on lifecycle events so
        // it never grows without bound across long sessions.
        if (event.kind === 'tool-call') {
          // Authoritative call has landed; any partial-args parser
          // we kept for this callId (or the matching surrogate) is
          // done. The owner prefix mirrors the reducer's
          // `clearPartialFor` rule.
          const owner = event.subagentId ?? 'orc';
          reconcileToolCallParser(runId, event.call.id, owner);
        } else if (event.kind === 'agent-text-aborted') {
          // The reducer also wipes ALL orchestrator partials on
          // abort (see `applyTimelineEvent.ts`). Mirror it here so
          // the parser pool stays in sync.
          dropAllParsersForRun(runId);
        } else if (
          event.kind === 'subagent-status' &&
          (event.status === 'done' ||
            event.status === 'failed' ||
            event.status === 'aborted')
        ) {
          // A worker reached a terminal state; any partial-args
          // parsers we kept for its callIds are dead. We don't know
          // exactly which callIds belong to this worker without an
          // index, so we walk the pool and drop any whose key
          // matches `pending:<subagentId>:` or whose owner is
          // implicitly the worker. Conservative: only drop
          // surrogates explicitly keyed under the worker. Real-id
          // entries are dropped via their own `tool-call`
          // reconciliation.
          const surrogatePrefix = `${runId}${PARSER_KEY_SEP}pending:${event.subagentId}:`;
          for (const key of parserPool.keys()) {
            if (key.startsWith(surrogatePrefix)) parserPool.delete(key);
          }
        }
        useChatStore.getState().applyEvent(runId, event);
      } catch (err) {
        log.warn('chat:event listener threw', { runId, err });
      }
    })
  );
  unsub.push(
    vyotiq.chat.onDone((runId) => {
      try {
        // Audit fix A3: flush any pending text/reasoning deltas
        // BEFORE the finish state lands so the renderer never
        // sees "settled then late delta" on a terminal run.
        flushAllTextForRun(runId);
        // Drop all parsers for this run before the store flushes the
        // run state — keeps the pool size bounded across long sessions.
        dropAllParsersForRun(runId);
        useChatStore.getState().finishRun(runId);
      } catch (err) {
        log.warn('chat:done listener threw', { runId, err });
      }
    })
  );
  unsub.push(
    vyotiq.chat.onError((runId, message) => {
      try {
        // Same drain rationale as `onDone` — terminal runs must not
        // leak buffered deltas onto the next event the user sees.
        flushAllTextForRun(runId);
        dropAllParsersForRun(runId);
        useChatStore.getState().errorRun(runId, message);
      } catch (err) {
        log.warn('chat:error listener threw', { runId, err });
      }
    })
  );

  // Cancel any pending RAF flush on channel teardown so an HMR
  // reload doesn't leak a frame callback into a freshly-rebound
  // store. Pushed last so it runs after the IPC unsubscribes (no
  // chance of a late delta enqueueing after the batcher is gone).
  // Also clears the parser pool + text-delta accumulator state —
  // same rationale as the boot guard.
  unsub.push(() => {
    argsDeltaBatcher.cancel();
    if (textDeltaRafHandle !== null) {
      rafCancel(textDeltaRafHandle);
      textDeltaRafHandle = null;
    }
    textDeltaAccumulators.clear();
    parserPool.clear();
  });

  globalsRef.__vyotiqChatChannelUnsub = unsub;

  // Rehydrate `runIdToConv` from main's snapshot of in-flight runs.
  // Without this, a renderer reload (HMR / F5) leaves the dispatch
  // table empty while orchestrator loops in main keep streaming
  // events with `runId`s the renderer no longer recognises — they'd
  // be silently dropped by `applyEvent`. Best-effort: a rejection
  // (e.g. main not yet ready, IPC bridge missing) is logged and
  // ignored; subsequent fresh sends still register their own
  // mappings via `useChatStore.send`.
  void vyotiq.chat
    .listActiveRuns()
    .then((infos) => {
      if (Array.isArray(infos) && infos.length > 0) {
        log.info('rehydrating active runs from main', { count: infos.length });
        useChatStore.getState().rehydrateActiveRuns(infos);
      }
    })
    .catch((err) => {
      log.debug('listActiveRuns failed during boot rehydration', { err });
    });
}

/**
 * Test-only handle to the parser pool. Lets the renderer test suite
 * assert pool size invariants (e.g. `bootstrapChatChannel` doesn't
 * leak parsers across HMR). NOT exported through the public store
 * surface; consumers outside the test layer should never reach for
 * this.
 *
 * Re-exposed via `globalThis` only when running under Vitest so the
 * production bundle drops it.
 */
export const __vyotiqChatChannelInternal = {
  parserPoolSize: () => parserPool.size,
  parserPoolKeys: () => Array.from(parserPool.keys()),
  // Audit fix A3 — text-delta accumulator introspection. Used by
  // renderer tests to assert that N rapid deltas under one frame
  // coalesce into one accumulator entry instead of N store
  // dispatches.
  textDeltaAccumulatorSize: () => textDeltaAccumulators.size,
  textDeltaAccumulatorKeys: () => Array.from(textDeltaAccumulators.keys()),
  resetForTest: () => {
    parserPool.clear();
    textDeltaAccumulators.clear();
  }
};
