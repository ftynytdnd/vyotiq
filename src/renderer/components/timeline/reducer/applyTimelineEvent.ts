/**
 * Pure reducer. Advances the renderer timeline state by exactly one event.
 *
 * Used by:
 *   - The live IPC bridge (chatChannel.ts) to apply each incoming event.
 *   - setTranscript() to rebuild state from a persisted transcript.
 *
 * All branches are immutable and never mutate the input state in place.
 */

import type { TimelineEvent, TokenUsage } from '@shared/types/chat.js';
import { tokenUsageCountsEqual } from '@shared/token/tokenUsageCountsEqual.js';
import { safeParsePartial } from '@shared/text/partialJsonParser.js';
import {
  INITIAL_TIMELINE_STATE,
  foldTokenUsage,
  setInFlightUsage,
  stampUsageStart,
  type PartialToolCallArgs,
  type LiveToolOutputSnapshot,
  type TimelineState
} from './types.js';
import { clearStreamingToolPreview } from './clearStreamingToolPreview.js';
import {
  appendTimelineEvent,
  autoCloseReasoning,
  clearPartialFor
} from './timelineReducerShared.js';

type TokenUsageEvent = Extract<TimelineEvent, { kind: 'token-usage' }>;

/** Replace the last same-turn usage row when counts match (late cache diagnostics). */
function coalesceTokenUsageEvent(
  events: TimelineEvent[],
  event: TokenUsageEvent,
  mutate: boolean
): TimelineEvent[] {
  for (let i = events.length - 1; i >= 0; i--) {
    const row = events[i];
    if (row?.kind !== 'token-usage') continue;
    if (row.assistantMsgId !== event.assistantMsgId) break;
    if (!tokenUsageCountsEqual(row.usage, event.usage)) break;
    const merged: TokenUsageEvent = {
      ...row,
      ts: event.ts,
      usage: event.usage,
      ...(event.cacheMissReason !== undefined
        ? { cacheMissReason: event.cacheMissReason }
        : row.cacheMissReason !== undefined
          ? { cacheMissReason: row.cacheMissReason }
          : {})
    };
    if (mutate) {
      events[i] = merged;
      return events;
    }
    const next = events.slice();
    next[i] = merged;
    return next;
  }
  return appendTimelineEvent(events, event, mutate);
}

/**
 * Optional reducer hooks. The renderer's IPC bridge (`chatChannel.ts`)
 * keeps a long-lived per-`(runId, callId)` `PartialJsonParser` pool to
 * make partial-JSON parsing O(delta) across the whole stream instead
 * of the O(n²) cost of `safeParsePartial` re-instantiating a fresh
 * parser per frame. When the bridge has already pre-parsed the
 * cumulative buffer, it passes the snapshot in via `preParsedArgs`
 * and the reducer skips its own one-shot parse.
 *
 * Phase 1.1 — keeps the reducer pure (the pool lives in chatChannel,
 * not here) while letting the live path bypass the per-frame parse.
 * Transcript replay (`rebuildTimelineState`) still pays the one-shot
 * cost since the persistent JSONL never carries `tool-call-args-delta`
 * events anyway, so the cost is theoretical there.
 */
export interface ApplyEventOptions {
  /**
   * Pre-parsed snapshot of `event.argsBuf` for a `tool-call-args-delta`
   * event. `null` when the buffer hasn't yet matched any valid JSON
   * prefix (mirrors `PartialJsonParser.feed` semantics). Ignored for
   * any other event kind.
   */
  preParsedArgs?: Record<string, unknown> | null;
  /**
   * Audit fix H-06. When `true`, the reducer pushes onto the existing
   * `state.events` array in place instead of allocating a fresh
   * `appendTimelineEvent(state.events, event, mutate)` slice on every append. ONLY safe in
   * batch-replay contexts (`rebuildTimelineState`) where the caller
   * owns the array and no concurrent reader depends on the old
   * reference. The live IPC path NEVER passes this flag — it relies
   * on the immutable-on-append contract so React selectors can detect
   * a changed event list via reference equality.
   *
   * Why this matters: every branch in this reducer returns
   * `events: appendTimelineEvent(state.events, event, mutate)`, which is O(k) on iteration
   * k of the rebuild. Replaying a 100k-event JSONL therefore costs
   * O(N²) array allocation (~5×10⁹ ops at N=100k → 5–30s of
   * main-thread block on the conversation switch). With the mutable
   * flag, replay drops to O(N) — measured 50–100ms.
   */
  mutateEvents?: boolean;
  /**
   * Transcript batch replay (`rebuildTimelineState`). Suppresses
   * session-scoped side effects such as live report auto-open markers.
   */
  replay?: boolean;
}

export function applyTimelineEvent(
  state: TimelineState,
  event: TimelineEvent,
  opts: ApplyEventOptions = {}
): TimelineState {
  // Audit fix H-06: capture once so every per-branch `appendTimelineEvent(...)`
  // call below reads the same `mutate` value. The default (immutable)
  // path is what the live IPC bridge takes — pushing onto the array
  // in place is reserved for `rebuildTimelineState`'s batch replay.
  const mutate = opts.mutateEvents === true;
  switch (event.kind) {
    case 'agent-text-delta': {
      const prev =
        state.assistantTexts[event.id] ??
        { id: event.id, text: '', done: false, startedAt: event.ts };
      // Append the event only once per id; subsequent deltas update the
      // accumulator but don't duplicate the event record.
      const firstSeen = !state.assistantTexts[event.id];
      // Reasoning is, by definition, finished the moment any non-
      // reasoning content begins streaming for the same assistant turn
      // id. Re-state that invariant here so the panel collapses even
      // when the upstream `agent-reasoning-end` marker is missing or
      // late (see `autoCloseReasoning` for the full rationale).
      const reasoningTexts = autoCloseReasoning(state.reasoningTexts, event.id, event.ts);
      // Phase 12 (2026): stamp the run's tok/s start anchor on the very
      // first delta. Idempotent — `stampUsageStart` no-ops once the
      // field is set, so subsequent deltas keep object identity.
      const orchestratorUsage = stampUsageStart(state.orchestratorUsage, event.ts);
      return {
        ...state,
        events: firstSeen ? appendTimelineEvent(state.events, event, mutate) : state.events,
        reasoningTexts,
        assistantTexts: {
          ...state.assistantTexts,
          [event.id]: { ...prev, text: prev.text + event.delta }
        },
        ...(orchestratorUsage !== state.orchestratorUsage ? { orchestratorUsage } : {})
      };
    }
    case 'agent-text-end': {
      const prev = state.assistantTexts[event.id];
      if (!prev) return state;
      return {
        ...state,
        assistantTexts: {
          ...state.assistantTexts,
          [event.id]: { ...prev, done: true }
        }
      };
    }
    case 'agent-text-aborted': {
      const { [event.id]: _droppedText, ...restText } = state.assistantTexts;
      const { [event.id]: _droppedReasoning, ...restReasoning } = state.reasoningTexts;
      void _droppedText;
      void _droppedReasoning;
      // Clear any in-flight orchestrator-level partial-args previews
      // that the aborted turn was streaming. Without this, a Stop
      // pressed mid-stream would leave the synthesized tool-group
      // row painted indefinitely (the authoritative `tool-call`
      // never lands to reconcile it).
      const nextPartial =
        Object.keys(state.partialToolCallArgs).length > 0 ? {} : state.partialToolCallArgs;
      return {
        ...state,
        events: state.events.filter(
          (e) =>
            !(
              (e.kind === 'agent-text-delta' && e.id === event.id) ||
              (e.kind === 'agent-reasoning-delta' && e.id === event.id)
            )
        ),
        assistantTexts: restText,
        reasoningTexts: restReasoning,
        ...(nextPartial !== state.partialToolCallArgs
          ? { partialToolCallArgs: nextPartial }
          : {})
      };
    }
    case 'agent-reasoning-delta': {
      const existing = state.reasoningTexts[event.id];
      const firstSeen = !existing;
      // Stamp `startedAt` on the first delta only; subsequent deltas keep
      // the original wall-clock so the run-time math reflects the full
      // span of the streamed reasoning.
      const prev = existing ?? {
        id: event.id,
        text: '',
        done: false,
        startedAt: event.ts,
        ...(event.effort !== undefined ? { effort: event.effort } : {})
      };
      // Phase 12 (2026): reasoning deltas count as "stream activity"
      // for the tok/s anchor (a thinking model's first wall-clock
      // event is usually a reasoning delta, not a text delta). Stamp
      // the same anchor here so a turn dominated by reasoning still
      // reports throughput once usage lands. Same idempotent no-op
      // pattern as the text-delta branch.
      const orchestratorUsage = stampUsageStart(state.orchestratorUsage, event.ts);
      return {
        ...state,
        events: firstSeen ? appendTimelineEvent(state.events, event, mutate) : state.events,
        reasoningTexts: {
          ...state.reasoningTexts,
          [event.id]: { ...prev, text: prev.text + event.delta }
        },
        ...(orchestratorUsage !== state.orchestratorUsage ? { orchestratorUsage } : {})
      };
    }
    case 'agent-reasoning-end': {
      const prev = state.reasoningTexts[event.id];
      if (!prev) return state;
      // Idempotent: if the stream already signaled reasoning-end
      // mid-turn (the common case for DeepSeek-style `reasoning_content`
      // → `content` transitions), keep the original `endedAt`. A later
      // end-of-turn emission would otherwise bloat the "Thought for Ns"
      // label with the time spent streaming the post-reasoning answer.
      if (prev.done) return state;
      return {
        ...state,
        reasoningTexts: {
          ...state.reasoningTexts,
          [event.id]: { ...prev, done: true, endedAt: event.ts }
        }
      };
    }

    case 'tool-call': {
      // Reconcile the live partial-args preview now that the
      // authoritative call has landed: drop the entry whose `callId`
      // matches the real one, OR — when the real id wasn't known yet
      // during streaming — drop the `pending:<owner>:<index>`
      // surrogate emitted during streaming. Without
      // this cleanup the synthesized in-flight row would linger
      // alongside the real one for the rest of the run.
      //
      // Audit fix H3: also stamp `settledCallIds[realCallId]` so the
      // `tool-call-args-delta` and `diff-stream` branches can drop
      // late frames that race the synchronous tool-call dispatch
      // (see types.ts:settledCallIds for the race description).
      const realCallId = event.call.id;
      const settledCallIds = state.settledCallIds[realCallId]
        ? state.settledCallIds
        : { ...state.settledCallIds, [realCallId]: true as const };
      const nextPartial = clearPartialFor(
        state.partialToolCallArgs,
        realCallId,
        'orc'
      );
      return {
        ...state,
        events: appendTimelineEvent(state.events, event, mutate),
        settledCallIds,
        toolCacheHint: null,
        ...(nextPartial !== state.partialToolCallArgs
          ? { partialToolCallArgs: nextPartial }
          : {})
      };
    }
    case 'tool-result': {
      const resultId = event.result.id;
      const { [resultId]: _dropLive, ...nextLiveDiff } = state.liveDiffByCallId;
      const { [resultId]: _dropOut, ...nextLiveOutput } = state.liveToolOutputByCallId;
      void _dropLive;
      void _dropOut;
      const toolResultSettledIds = {
        ...state.toolResultSettledIds,
        [resultId]: true as const
      };
      const liveReportResultIds =
        !opts.replay &&
        event.result.name === 'report' &&
        event.result.ok
          ? { ...state.liveReportResultIds, [resultId]: true as const }
          : state.liveReportResultIds;
      const toolCacheHint =
        !opts.replay && event.result.output.includes('[cache]')
          ? `Cached ${event.result.name} — no disk I/O`
          : state.toolCacheHint;
      return {
        ...state,
        events: appendTimelineEvent(state.events, event, mutate),
        liveDiffByCallId: nextLiveDiff,
        liveToolOutputByCallId: nextLiveOutput,
        toolResultSettledIds,
        liveReportResultIds,
        toolCacheHint
      };
    }
    case 'attachment-pre-read': {
      return {
        ...state,
        events: appendTimelineEvent(state.events, event, mutate)
      };
    }
    case 'file-edit': {
      const eventsNext = appendTimelineEvent(state.events, event, mutate);
      // Maintain per-runId counts. Both orchestrator-level and
      // A single counter slot per `runId` captures
      // the full per-turn FS impact for the inline Revert badge on
      // `UserPromptRow`. Skip the increment when `runId` is absent
      // (legacy transcripts) — the badge simply renders no count.
      const runIdToFileEditCount =
        typeof event.runId === 'string' && event.runId.length > 0
          ? {
            ...state.runIdToFileEditCount,
            [event.runId]: (state.runIdToFileEditCount[event.runId] ?? 0) + 1
          }
          : state.runIdToFileEditCount;
      return { ...state, events: eventsNext, runIdToFileEditCount };
    }

    case 'token-usage': {
      const eventsNext = coalesceTokenUsageEvent(state.events, event, mutate);
      const sameTurn =
        state.orchestratorUsage?.lastTurnAssistantMsgId === event.assistantMsgId;
      const lastPromptCacheMissReason =
        event.cacheMissReason !== undefined
          ? event.cacheMissReason
          : sameTurn
            ? state.lastPromptCacheMissReason
            : undefined;
      return {
        ...state,
        events: eventsNext,
        orchestratorUsage: foldTokenUsage(
          state.orchestratorUsage,
          event.usage,
          event.ts,
          event.assistantMsgId
        ),
        lastPromptCacheMissReason
      };
    }

    case 'run-status': {
      // `run-status` is pure live telemetry — never persisted to JSONL
      // (see `isPersistentEvent` in `chat.ipc.ts`) and never rendered
      // as an inline timeline row (`deriveRows` skips it).
      //
      // We deliberately do NOT push run-status events into `state.events`.
      // Doing so churned the array reference 5–10× per iteration for
      // every phase flip (`preparing-turn` → `connecting` →
      // `awaiting-response` → `running-tool` → …) and forced
      // `Timeline`'s `useMemo(deriveRows, [events])` to re-walk the
      // entire transcript every time, even though no row was produced.
      // Audit fix §3.2.1.
      //
      return {
        ...state,
        latestOrchestratorRunStatus: event
      };
    }

    case 'user-prompt':
      // Track `lastUserPromptId` as a primitive so `Timeline`'s
      // snap-on-send effect can depend on it directly instead of
      // reverse-scanning `events` on every streaming delta. Audit
      // fix §3.2.2. Audit fix C2 also tracks `lastUserPromptContent`
      // here so the regenerate affordance on `AssistantTextRow` is
      // an O(1) selector lookup instead of an O(n) walk.
      //
      // Audit fix M-16: prune the per-run `settledCallIds` map on
      // each new user turn. The map is the late-frame race guard
      // (see the `tool-call` branch) and is purely per-turn — by
      // the time a fresh `user-prompt` arrives, any straggling
      // late-arriving args-delta for a previous turn's callId is
      // long settled. Without this prune the map grew linearly
      // across the conversation's lifetime (one entry per
      // historical tool call); after a hundred turns of tool use
      // it carried thousands of stale entries.
      return clearStreamingToolPreview({
        ...state,
        events: appendTimelineEvent(state.events, event, mutate),
        lastUserPromptId: event.id,
        lastUserPromptContent: event.content
      });
    case 'agent-thought':
    case 'ask-user-prompt':
    case 'phase':
    case 'error':
      return { ...state, events: appendTimelineEvent(state.events, event, mutate) };

    case 'ask-user-submitted': {
      const nextEvents = appendTimelineEvent(state.events, event, mutate);
      const marked = nextEvents.map((e) =>
        e.kind === 'ask-user-prompt' && e.id === event.promptEventId
          ? { ...e, status: 'submitted' as const }
          : e
      );
      return { ...state, events: marked };
    }

    case 'checkpoint-entry':
    case 'checkpoint-revert':
    case 'checkpoint-bash-mutation':
    case 'tool-compacted':
    case 'context-summary':
      // Audit-trail kinds persisted into the transcript so replay
      // reconstructs the same state the live run had (`tool-compacted`
      // and `context-summary` let the main-process replay rebuild lean
      // banners / collapsed history). The checkpoint kinds produce no
      // derived row; `tool-compacted` / `context-summary` fold into a single
      // `context-reduction` audit row (see `deriveRows.ts`).
      return { ...state, events: appendTimelineEvent(state.events, event, mutate) };

    case 'context-usage':
      // Context-window meter telemetry — persisted for replay-accurate
      // breakdown; no inline timeline row.
      return {
        ...state,
        events: appendTimelineEvent(state.events, event, mutate),
        latestContextUsage: event
      };

    case 'diff-stream': {
      // Phase 2 — main-process FS-aware live diff. Folds into the
      // matching `partialToolCallArgs` entry's `diffStream` slot so
      // the existing partial-tool-group rendering picks it up
      // alongside the renderer-side synthesised preview. Cumulative
      // semantics (latest event for a callId supersedes earlier
      // ones) match the `tool-call-args-delta` lifecycle.
      //
      // If the partial entry doesn't exist yet (the diff-stream
      // beat the first args-delta — possible when the model emitted
      // the call name + args in a single frame), seed a minimal
      // entry so the diff still renders. The args-delta that lands
      // afterwards merges with the existing entry.
      //
      // Audit fix H3: drop late frames that race the synchronous
      // tool-call dispatch. The settle re-emit (audit fix H8)
      // intentionally lands BEFORE `tool-call` and is therefore
      // accepted (the settledCallIds gate hasn't fired yet); any
      // frame after the tool-result is a stale leftover.
      if (state.toolResultSettledIds[event.callId]) return state;
      const snapshot = {
        tool: event.tool,
        filePath: event.filePath,
        hunks: event.hunks,
        additions: event.additions,
        deletions: event.deletions,
        settled: event.settled === true,
        ts: event.ts
      };
      const existing = state.partialToolCallArgs[event.callId];
      const nextEntry: PartialToolCallArgs = existing
        ? { ...existing, diffStream: snapshot, ts: event.ts }
        : {
          callId: event.callId,
          index: 0,
          argsBuf: '',
          parsed: null,
          ts: event.ts,
          diffStream: snapshot
        };
      return {
        ...state,
        partialToolCallArgs: {
          ...state.partialToolCallArgs,
          [event.callId]: nextEntry
        },
        liveDiffByCallId: {
          ...state.liveDiffByCallId,
          [event.callId]: snapshot
        }
      };
    }

    case 'tool-output-delta': {
      if (state.toolResultSettledIds[event.callId]) return state;
      const snapshot: LiveToolOutputSnapshot = {
        tool: 'bash',
        command: event.command,
        stdout: event.stdout,
        stderr: event.stderr,
        stdoutTruncated: event.stdoutTruncated === true,
        stderrTruncated: event.stderrTruncated === true,
        startedAt: event.startedAt,
        ts: event.ts
      };
      return {
        ...state,
        liveToolOutputByCallId: {
          ...state.liveToolOutputByCallId,
          [event.callId]: snapshot
        }
      };
    }

    case 'tool-call-args-delta': {
      // Streaming partial-args preview. Fold the cumulative buffer
      // into `partialToolCallArgs` (orchestrator-level) or the
      // matching partial snapshot. We DON'T append the event to
      // `state.events` — it's ephemeral live telemetry and the
      // event list is the persistent backbone of replay.
      //
      // Audit fix H3: drop late deltas whose `tool-call` has already
      // been applied. The args-delta path is RAF-batched in
      // `chatChannel`, so a delta enqueued before the synchronous
      // `tool-call` dispatch can drain ONE frame after the partial
      // entry was cleared — without this guard the late delta would
      // resurrect an orphan partial entry.
      if (state.settledCallIds[event.callId]) return state;
      // Parsing strategy:
      //   - Live path: `chatChannel.ts` keeps a long-lived
      //     `PartialJsonParser` per `(runId, callId)` and passes the
      //     pre-parsed snapshot in via `opts.preParsedArgs`. That
      //     keeps the parse O(delta) across the whole stream — vs.
      //     the O(n²) cost of re-instantiating a fresh parser
      //     here on every frame.
      //   - Replay path: persistent JSONL never carries this kind
      //     so the fallback `safeParsePartial` is theoretical, but
      //     defensive callers (tests, transcript reload of an
      //     in-memory pre-1.1 fixture) still get correct behaviour.
      const parsed =
        opts.preParsedArgs !== undefined
          ? opts.preParsedArgs
          : safeParsePartial(event.argsBuf);
      const existing = state.partialToolCallArgs[event.callId];
      const entry: PartialToolCallArgs = {
        callId: event.callId,
        ...(event.name !== undefined
          ? { name: event.name }
          : existing?.name !== undefined
            ? { name: existing.name }
            : {}),
        index: event.index,
        argsBuf: event.argsBuf,
        parsed,
        ts: event.ts,
        ...(existing?.diffStream ? { diffStream: existing.diffStream } : {})
      };
      return {
        ...state,
        partialToolCallArgs: {
          ...state.partialToolCallArgs,
          [event.callId]: entry
        }
      };
    }

    case 'synthetic-usage-update': {
      // Phase 3 (2026): renderer-local mid-stream completion-token
      // estimate. Route to the matching aggregate's `inFlight` slot.
      // `latest` and the peak/cumulative aggregates are untouched —
      // the authoritative `token-usage` event always wins on arrival
      // and clears `inFlight` via `foldTokenUsage`'s contract.
      //
      // NOT appended to `events` — this is pure live telemetry; the
      // renderer reads it through selectors on the aggregate. Mirrors
      // the same treatment `token-usage` itself gets.
      const synthetic: TokenUsage = {
        promptTokens: 0,
        completionTokens: event.completionTokens,
        totalTokens: event.completionTokens
      };
      return {
        ...state,
        orchestratorUsage: setInFlightUsage(state.orchestratorUsage, synthetic)
      };
    }

    default: {
      const _exhaustive: never = event;
      void _exhaustive;
      return state;
    }
  }
}

/**
 * Rebuild the full timeline state from a persisted transcript.
 *
 * Audit fix H-06: pre-allocates a single mutable `events` array and
 * threads `mutateEvents: true` through every `applyTimelineEvent`
 * call so each append is an in-place `Array.prototype.push` instead
 * of a fresh `[...prev, e]` slice. The previous implementation was
 * O(N²) in allocation (1 + 2 + … + N array slots over N events);
 * the live IPC path is unchanged and still pays the immutable cost
 * per event for selector-equality reasons (see the
 * `ApplyEventOptions.mutateEvents` JSDoc).
 *
 * Empirically: a 100k-event JSONL goes from ~5–30 s of main-thread
 * block down to ~50–100 ms with this change.
 */
export function rebuildTimelineState(events: TimelineEvent[]): TimelineState {
  // Pre-size the accumulator to the input length so V8 / SpiderMonkey
  // can allocate a single backing store instead of growing+copying
  // log₂N times. `Array(N)` creates a sparse array; the reducer's
  // `push` calls re-densify it from index 0 upward.
  const eventsAcc: TimelineEvent[] = [];
  if (events.length > 0) {
    // Hint the engine about the final length without inserting holes
    // — `length = N` reserves capacity but `push` still bumps the
    // logical length from 0.
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    eventsAcc.length = events.length;
    eventsAcc.length = 0;
  }
  let s: TimelineState = { ...INITIAL_TIMELINE_STATE, events: eventsAcc };
  for (const e of events) {
    s = applyTimelineEvent(s, e, { mutateEvents: true, replay: true });
  }
  return s;
}

