/**
 * Pure reducer. Advances the renderer timeline state by exactly one event.
 *
 * Used by:
 *   - The live IPC bridge (chatChannel.ts) to apply each incoming event.
 *   - setTranscript() to rebuild state from a persisted transcript.
 *
 * All branches are immutable and never mutate the input state in place.
 */

import type { TimelineEvent } from '@shared/types/chat.js';
import type { ToolCall, ToolResult } from '@shared/types/tool.js';
import { safeParsePartial } from '@shared/text/partialJsonParser.js';
import {
  INITIAL_TIMELINE_STATE,
  foldTokenUsage,
  type AssistantTextAcc,
  type PartialToolCallArgs,
  type ReasoningTextAcc,
  type SubAgentSnapshot,
  type SubAgentStep,
  type TimelineState
} from './types.js';

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
   * `appendEvent(state.events, event, mutate)` slice on every append. ONLY safe in
   * batch-replay contexts (`rebuildTimelineState`) where the caller
   * owns the array and no concurrent reader depends on the old
   * reference. The live IPC path NEVER passes this flag — it relies
   * on the immutable-on-append contract so React selectors can detect
   * a changed event list via reference equality.
   *
   * Why this matters: every branch in this reducer returns
   * `events: appendEvent(state.events, event, mutate)`, which is O(k) on iteration
   * k of the rebuild. Replaying a 100k-event JSONL therefore costs
   * O(N²) array allocation (~5×10⁹ ops at N=100k → 5–30s of
   * main-thread block on the conversation switch). With the mutable
   * flag, replay drops to O(N) — measured 50–100ms.
   */
  mutateEvents?: boolean;
}

/**
 * Append `event` to `events`, either immutably (default — fresh slice)
 * or mutably (push in place) when called from
 * `rebuildTimelineState`. See `ApplyEventOptions.mutateEvents` for
 * the full rationale. Audit fix H-06.
 */
function appendEvent(
  events: TimelineEvent[],
  event: TimelineEvent,
  mutate: boolean
): TimelineEvent[] {
  if (mutate) {
    events.push(event);
    return events;
  }
  return [...events, event];
}

/**
 * Defensive belt-and-suspenders for the reasoning-end path.
 *
 * The orchestrator emits `agent-reasoning-end` the instant the stream
 * transitions from `reasoning_content` to `content` / `tool_calls` (see
 * `consumeChatStream.maybeCloseReasoning`). For well-behaved providers
 * that single marker is enough to flip the panel from "Thinking…" to
 * "Thought for Ns" the moment text starts streaming.
 *
 * However, `agent-reasoning-end` is logically derivable from observable
 * state: if any non-reasoning content (text or tool_call) is arriving
 * for the same `id` as an open reasoning accumulator, reasoning is by
 * definition done. We re-state that invariant here so the panel
 * collapses correctly even if the marker is dropped by a misbehaving
 * provider, lost in IPC, or missing from a legacy persisted transcript.
 *
 * Idempotent: if `done` is already true, the existing `endedAt` is
 * preserved (we never want to overwrite the real reasoning-end
 * timestamp with a later text-delta one — that would bloat the
 * "Thought for Ns" label).
 */
function autoCloseReasoning(
  reasoningTexts: Record<string, ReasoningTextAcc>,
  id: string,
  ts: number
): Record<string, ReasoningTextAcc> {
  const prev = reasoningTexts[id];
  if (!prev || prev.done) return reasoningTexts;
  return {
    ...reasoningTexts,
    [id]: { ...prev, done: true, endedAt: ts }
  };
}

/**
 * Drop the partial-args entry that corresponds to `realCallId`. The
 * caller has just observed the authoritative `tool-call` event so the
 * synthesized in-flight preview must give way to the real call's row.
 *
 * Two matching paths:
 *   1. Exact `callId` match — the provider sent the real id from the
 *      first delta and the entry was already keyed under it.
 *   2. Lowest-index surrogate match — the provider withheld the id
 *      during streaming, so the orchestrator/SubAgent coined a
 *      surrogate keyed by `pending:<owner>:<index>`. The runtime
 *      processes settled tool calls in index order, so the FIRST
 *      authoritative `tool-call` to land for an owner corresponds
 *      to the LOWEST-index surrogate. Subsequent calls each pair
 *      with the next-lowest, leaving in-flight higher-index
 *      previews untouched (matters for OpenAI's parallel
 *      tool-call streams).
 *
 * Returns the same map reference when nothing changed so the parent
 * reducer can avoid a needless state churn.
 */
function clearPartialFor(
  prior: Record<string, import('./types.js').PartialToolCallArgs>,
  realCallId: string,
  owner: string
): Record<string, import('./types.js').PartialToolCallArgs> {
  if (realCallId in prior) {
    const { [realCallId]: _drop, ...rest } = prior;
    void _drop;
    return rest;
  }
  // Find the lowest-index surrogate for this owner and drop it.
  const surrogatePrefix = `pending:${owner}:`;
  let lowestKey: string | null = null;
  let lowestIndex = Number.POSITIVE_INFINITY;
  for (const key of Object.keys(prior)) {
    if (!key.startsWith(surrogatePrefix)) continue;
    const entry = prior[key]!;
    if (entry.index < lowestIndex) {
      lowestIndex = entry.index;
      lowestKey = key;
    }
  }
  if (lowestKey === null) return prior;
  const { [lowestKey]: _drop, ...rest } = prior;
  void _drop;
  return rest;
}

function ensureSnapshot(
  byId: Record<string, SubAgentSnapshot>,
  id: string,
  ts: number
): SubAgentSnapshot {
  const existing = byId[id];
  if (existing) return existing;
  return {
    id,
    task: '',
    files: [],
    missingFiles: [],
    tools: [],
    status: 'running',
    startedAt: ts,
    steps: [],
    fileEdits: [],
    assistantTexts: {},
    reasoningTexts: {},
    iterationOrder: [],
    partialToolCallArgs: {}
  };
}

function upsertStep(
  steps: SubAgentStep[],
  patch: { callId: string; call?: ToolCall; result?: ToolResult; ts: number }
): SubAgentStep[] {
  const idx = steps.findIndex((s) => s.callId === patch.callId);
  if (idx === -1) {
    const next: SubAgentStep = {
      callId: patch.callId,
      startedAt: patch.ts,
      ...(patch.call ? { call: patch.call } : {}),
      ...(patch.result ? { result: patch.result, endedAt: patch.ts } : {})
    };
    return [...steps, next];
  }
  const cur = steps[idx]!;
  const merged: SubAgentStep = {
    ...cur,
    ...(patch.call ? { call: patch.call } : {}),
    ...(patch.result ? { result: patch.result, endedAt: cur.endedAt ?? patch.ts } : {})
  };
  return steps.map((s, i) => (i === idx ? merged : s));
}

/**
 * Routes a sub-agent-scoped streaming text/reasoning event into the
 * matching snapshot's per-iteration accumulators. Mirrors the
 * orchestrator-level branches below but writes into
 * `subagents[id].{assistantTexts,reasoningTexts,iterationOrder}`
 * instead of the top-level state slots. Audit fix §1.1.
 *
 * The event is NOT pushed onto `state.events` — the snapshot's
 * accumulator is the authoritative render surface for sub-agent
 * bodies. Persistence + replay of the sub-agent transcript still
 * works because `rebuildTimelineState` re-runs every persisted
 * event through this same reducer.
 */
function applySubagentStreamingEvent(
  state: TimelineState,
  event: Extract<
    TimelineEvent,
    {
      kind:
      | 'agent-text-delta'
      | 'agent-text-end'
      | 'agent-text-aborted'
      | 'agent-reasoning-delta'
      | 'agent-reasoning-end';
      subagentId?: string;
    }
  > & { subagentId: string }
): TimelineState {
  const cur = ensureSnapshot(state.subagents, event.subagentId, event.ts);
  switch (event.kind) {
    case 'agent-text-delta': {
      const existing = cur.assistantTexts[event.id];
      const firstSeen = !existing;
      const prev =
        existing ?? { id: event.id, text: '', done: false, startedAt: event.ts };
      // Auto-close reasoning when text starts streaming for the same
      // iteration id (mirrors the orchestrator-level invariant — see
      // `autoCloseReasoning`).
      const reasoningTexts = autoCloseReasoning(cur.reasoningTexts, event.id, event.ts);
      const next: SubAgentSnapshot = {
        ...cur,
        reasoningTexts,
        assistantTexts: {
          ...cur.assistantTexts,
          [event.id]: { ...prev, text: prev.text + event.delta }
        },
        iterationOrder:
          firstSeen && !cur.iterationOrder.includes(event.id)
            ? [...cur.iterationOrder, event.id]
            : cur.iterationOrder
      };
      return {
        ...state,
        subagents: { ...state.subagents, [event.subagentId]: next }
      };
    }
    case 'agent-text-end': {
      const prev = cur.assistantTexts[event.id];
      if (!prev) return state;
      const next: SubAgentSnapshot = {
        ...cur,
        assistantTexts: {
          ...cur.assistantTexts,
          [event.id]: { ...prev, done: true }
        }
      };
      return {
        ...state,
        subagents: { ...state.subagents, [event.subagentId]: next }
      };
    }
    case 'agent-text-aborted': {
      const { [event.id]: _droppedText, ...restText } = cur.assistantTexts;
      const { [event.id]: _droppedReasoning, ...restReasoning } = cur.reasoningTexts;
      void _droppedText;
      void _droppedReasoning;
      const next: SubAgentSnapshot = {
        ...cur,
        assistantTexts: restText,
        reasoningTexts: restReasoning,
        iterationOrder: cur.iterationOrder.filter((id) => id !== event.id)
      };
      // Symmetry with the orchestrator-scoped abort branch below
      // (audit fix D1): also scrub any persisted delta events for this
      // iteration so a future `rebuildTimelineState` on the live
      // transcript doesn't re-materialize a body we already dropped.
      // Scoped to events tagged with THIS worker's `subagentId` so
      // parallel workers' bodies stay intact.
      return {
        ...state,
        events: state.events.filter(
          (e) =>
            !(
              (e.kind === 'agent-text-delta' ||
                e.kind === 'agent-reasoning-delta') &&
              e.id === event.id &&
              e.subagentId === event.subagentId
            )
        ),
        subagents: { ...state.subagents, [event.subagentId]: next }
      };
    }
    case 'agent-reasoning-delta': {
      const existing = cur.reasoningTexts[event.id];
      const firstSeen = !existing;
      const prev =
        existing ?? { id: event.id, text: '', done: false, startedAt: event.ts };
      const next: SubAgentSnapshot = {
        ...cur,
        reasoningTexts: {
          ...cur.reasoningTexts,
          [event.id]: { ...prev, text: prev.text + event.delta }
        },
        iterationOrder:
          firstSeen && !cur.iterationOrder.includes(event.id)
            ? [...cur.iterationOrder, event.id]
            : cur.iterationOrder
      };
      return {
        ...state,
        subagents: { ...state.subagents, [event.subagentId]: next }
      };
    }
    case 'agent-reasoning-end': {
      const prev = cur.reasoningTexts[event.id];
      if (!prev || prev.done) return state;
      const next: SubAgentSnapshot = {
        ...cur,
        reasoningTexts: {
          ...cur.reasoningTexts,
          [event.id]: { ...prev, done: true, endedAt: event.ts }
        }
      };
      return {
        ...state,
        subagents: { ...state.subagents, [event.subagentId]: next }
      };
    }
  }
}

export function applyTimelineEvent(
  state: TimelineState,
  event: TimelineEvent,
  opts: ApplyEventOptions = {}
): TimelineState {
  // Audit fix H-06: capture once so every per-branch `appendEvent(...)`
  // call below reads the same `mutate` value. The default (immutable)
  // path is what the live IPC bridge takes — pushing onto the array
  // in place is reserved for `rebuildTimelineState`'s batch replay.
  const mutate = opts.mutateEvents === true;
  switch (event.kind) {
    case 'agent-text-delta': {
      // Sub-agent-scoped streaming text routes into the matching
      // snapshot's per-iteration accumulator instead of the
      // orchestrator-level slot. Audit fix §1.1.
      if (event.subagentId) {
        return applySubagentStreamingEvent(
          state,
          event as Parameters<typeof applySubagentStreamingEvent>[1]
        );
      }
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
      return {
        ...state,
        events: firstSeen ? appendEvent(state.events, event, mutate) : state.events,
        reasoningTexts,
        assistantTexts: {
          ...state.assistantTexts,
          [event.id]: { ...prev, text: prev.text + event.delta }
        }
      };
    }
    case 'agent-text-end': {
      if (event.subagentId) {
        return applySubagentStreamingEvent(
          state,
          event as Parameters<typeof applySubagentStreamingEvent>[1]
        );
      }
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
      if (event.subagentId) {
        return applySubagentStreamingEvent(
          state,
          event as Parameters<typeof applySubagentStreamingEvent>[1]
        );
      }
      const { [event.id]: _droppedText, ...restText } = state.assistantTexts;
      const { [event.id]: _droppedReasoning, ...restReasoning } = state.reasoningTexts;
      void _droppedText;
      void _droppedReasoning;
      // Clear any in-flight orchestrator-level partial-args previews
      // that the aborted turn was streaming. Without this, a Stop
      // pressed mid-stream would leave the synthesized tool-group
      // row painted indefinitely (the authoritative `tool-call`
      // never lands to reconcile it). Sub-agent partials are wiped
      // in the analogous `applySubagentStreamingEvent` branch when
      // the worker's status flips terminal.
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
      if (event.subagentId) {
        return applySubagentStreamingEvent(
          state,
          event as Parameters<typeof applySubagentStreamingEvent>[1]
        );
      }
      const existing = state.reasoningTexts[event.id];
      const firstSeen = !existing;
      // Stamp `startedAt` on the first delta only; subsequent deltas keep
      // the original wall-clock so the run-time math reflects the full
      // span of the streamed reasoning.
      const prev = existing ?? {
        id: event.id,
        text: '',
        done: false,
        startedAt: event.ts
      };
      return {
        ...state,
        events: firstSeen ? appendEvent(state.events, event, mutate) : state.events,
        reasoningTexts: {
          ...state.reasoningTexts,
          [event.id]: { ...prev, text: prev.text + event.delta }
        }
      };
    }
    case 'agent-reasoning-end': {
      if (event.subagentId) {
        return applySubagentStreamingEvent(
          state,
          event as Parameters<typeof applySubagentStreamingEvent>[1]
        );
      }
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

    case 'subagent-pending': {
      // First user-visible signal that a delegate directive has been
      // parsed mid-stream. Materialize an empty snapshot in `pending`
      // status so SubAgentTrace can render the row immediately. If a
      // `subagent-spawn` later carries authoritative `task` / `files`
      // values, those overwrite the directive's slots in the spawn
      // branch below.
      //
      // Re-use semantics (audit fix A1): if an earlier round used the
      // same `subagentId` and that snapshot is already TERMINAL
      // (`done` / `failed` / `aborted`), the incoming directive is a
      // fresh round that happens to reuse the id — reset the snapshot
      // cleanly so the new task/files/tools aren't silently attached
      // to the previous round's body. Events remain in `state.events`
      // as an audit trail so transcript replay can reconstruct both
      // rounds; only the live-render snapshot is reset.
      //
      // If the snapshot is still `running`, treat this as a noisy
      // re-emission (shouldn't happen with the current mid-stream
      // gate but defend anyway) and drop the event entirely (audit
      // fix A7) — appending it would churn the events array without
      // changing the render.
      const existing = state.subagents[event.subagentId];
      const isTerminal =
        existing?.status === 'done' ||
        existing?.status === 'failed' ||
        existing?.status === 'aborted';
      if (existing && !isTerminal && existing.status !== 'pending') {
        // `running` (or any future non-terminal non-pending state) —
        // no-op: don't regress, don't double-append.
        return state;
      }
      const carryExisting = existing && !isTerminal;
      const next: SubAgentSnapshot = {
        id: event.subagentId,
        task: event.task,
        files: event.files,
        // `subagent-pending` is emitted from the directive parser before
        // the orchestrator has touched the FS, so it never carries
        // `missingFiles`. Carry through whatever the (possibly later)
        // spawn already populated; default to empty.
        missingFiles: carryExisting ? existing.missingFiles : [],
        // F-009: defensive `?.length ?? 0` mirrors the same guard at
        // the spawn branch below. Legacy persisted `subagent-pending`
        // events (pre-A2) did not carry the `tools` field; transcript
        // replay walks the same reducer, and an unguarded
        // `event.tools.length` would crash there.
        tools:
          (event.tools?.length ?? 0) > 0
            ? event.tools
            : carryExisting
              ? existing.tools
              : [],
        status: 'pending',
        startedAt: event.ts,
        steps: carryExisting ? existing.steps : [],
        fileEdits: carryExisting ? existing.fileEdits : [],
        // Carry through any worker streaming state already accumulated
        // (Audit fix §1.1) so a `subagent-pending` re-emit can never
        // wipe a body the user is actively reading. On a TERMINAL
        // re-use (audit fix A1) everything resets — the new round's
        // body is a fresh surface.
        assistantTexts: carryExisting ? existing.assistantTexts : {},
        reasoningTexts: carryExisting ? existing.reasoningTexts : {},
        iterationOrder: carryExisting ? existing.iterationOrder : [],
        partialToolCallArgs: carryExisting ? existing.partialToolCallArgs : {}
      };
      return {
        ...state,
        events: appendEvent(state.events, event, mutate),
        subagents: { ...state.subagents, [event.subagentId]: next }
      };
    }
    case 'subagent-spawn': {
      const existing = state.subagents[event.subagentId];
      const next: SubAgentSnapshot = {
        id: event.subagentId,
        // Prefer the spawn's authoritative slots, but fall back to the
        // pending-row slots when present (delegate directive carried the
        // task before the spawn arrived).
        task: event.task || existing?.task || '',
        files: event.files.length > 0 ? event.files : existing?.files ?? [],
        // Defensive `?? []` because legacy persisted spawn events
        // (pre-`missingFiles`) do not carry the field — transcript
        // replay walks the same reducer.
        missingFiles: event.missingFiles ?? existing?.missingFiles ?? [],
        // Spawn now carries `tools` too (audit fix A2). Prefer the
        // spawn's list when non-empty; fall back to the pending row's
        // list for robustness when the directive gated the pending
        // emission somehow. Defensive `?? []` because legacy
        // persisted events (pre-A2) do not carry the field —
        // transcript replay walks the same reducer over them.
        tools: (event.tools?.length ?? 0) > 0 ? event.tools : existing?.tools ?? [],
        status: 'running',
        startedAt: existing?.startedAt ?? event.ts,
        steps: existing?.steps ?? [],
        fileEdits: existing?.fileEdits ?? [],
        // Preserve any worker streaming state already accumulated
        // (Audit fix §1.1).
        assistantTexts: existing?.assistantTexts ?? {},
        reasoningTexts: existing?.reasoningTexts ?? {},
        iterationOrder: existing?.iterationOrder ?? [],
        partialToolCallArgs: existing?.partialToolCallArgs ?? {}
      };
      return {
        ...state,
        events: appendEvent(state.events, event, mutate),
        subagents: { ...state.subagents, [event.subagentId]: next }
      };
    }
    case 'subagent-status': {
      const cur = state.subagents[event.subagentId];
      if (!cur) return { ...state, events: appendEvent(state.events, event, mutate) };
      // Terminal transition clears the per-worker live-status pill so
      // the row stops shimmering the moment the worker settles. The
      // `liveStatus` slot is re-set only by subsequent `run-status`
      // events (which cannot arrive post-terminal for this id under
      // the current emit contract; belt-and-suspenders still).
      const { liveStatus: _prior, ...rest } = cur;
      void _prior;
      // Close any open per-iteration accumulators so the worker's
      // streaming body stops shimmering and shows a definitive
      // "settled" state. Audit fix §1.1 — without this a sub-agent
      // that aborted mid-stream (provider 500, manual stop) leaves
      // its body permanently shimmering. We mirror the existing
      // orchestrator behavior where `agent-text-end` flips `done` —
      // the closing semantics for a terminal status are identical.
      const closedTexts: Record<string, AssistantTextAcc> = {};
      for (const id of Object.keys(rest.assistantTexts)) {
        const t = rest.assistantTexts[id]!;
        closedTexts[id] = t.done ? t : { ...t, done: true };
      }
      const closedReasoning: Record<string, ReasoningTextAcc> = {};
      for (const id of Object.keys(rest.reasoningTexts)) {
        const r = rest.reasoningTexts[id]!;
        closedReasoning[id] = r.done ? r : { ...r, done: true, endedAt: r.endedAt ?? event.ts };
      }
      // On terminal status, also wipe any partial-args entries this
      // worker had in flight. The authoritative `tool-call` would
      // normally reconcile them, but a worker that crashed / aborted
      // before settling its last tool would leave the synthesized
      // row painted forever. Non-terminal status (`running`) keeps
      // the partials so the streaming preview survives a `nudging`
      // status flip mid-stream.
      const isTerminal =
        event.status === 'done' ||
        event.status === 'failed' ||
        event.status === 'aborted';
      const nextPartial = isTerminal && Object.keys(rest.partialToolCallArgs).length > 0
        ? {}
        : rest.partialToolCallArgs;
      const next: SubAgentSnapshot = {
        ...rest,
        status: event.status,
        endedAt: event.ts,
        assistantTexts: closedTexts,
        reasoningTexts: closedReasoning,
        partialToolCallArgs: nextPartial,
        ...(event.message !== undefined ? { message: event.message } : {})
      };
      return {
        ...state,
        events: appendEvent(state.events, event, mutate),
        subagents: { ...state.subagents, [event.subagentId]: next }
      };
    }
    case 'subagent-result': {
      const cur = state.subagents[event.subagentId];
      if (!cur) return { ...state, events: appendEvent(state.events, event, mutate) };
      return {
        ...state,
        events: appendEvent(state.events, event, mutate),
        subagents: {
          ...state.subagents,
          [event.subagentId]: { ...cur, output: event.output }
        }
      };
    }

    case 'tool-call': {
      // Reconcile the live partial-args preview now that the
      // authoritative call has landed: drop the entry whose `callId`
      // matches the real one, OR — when the real id wasn't known yet
      // during streaming — drop the `pending:<owner>:<index>`
      // surrogate that the orchestrator/SubAgent emitted. Without
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
      if (!event.subagentId) {
        const nextPartial = clearPartialFor(
          state.partialToolCallArgs,
          realCallId,
          'orc'
        );
        return {
          ...state,
          events: appendEvent(state.events, event, mutate),
          settledCallIds,
          ...(nextPartial !== state.partialToolCallArgs
            ? { partialToolCallArgs: nextPartial }
            : {})
        };
      }
      const cur = ensureSnapshot(state.subagents, event.subagentId, event.ts);
      const steps = upsertStep(cur.steps, {
        callId: event.call.id,
        call: event.call,
        ts: event.ts
      });
      const nextPartial = clearPartialFor(
        cur.partialToolCallArgs,
        realCallId,
        event.subagentId
      );
      return {
        ...state,
        events: appendEvent(state.events, event, mutate),
        settledCallIds,
        subagents: {
          ...state.subagents,
          [event.subagentId]: { ...cur, steps, partialToolCallArgs: nextPartial }
        }
      };
    }
    case 'tool-result': {
      if (!event.subagentId) {
        return { ...state, events: appendEvent(state.events, event, mutate) };
      }
      const cur = ensureSnapshot(state.subagents, event.subagentId, event.ts);
      const steps = upsertStep(cur.steps, {
        callId: event.result.id,
        result: event.result,
        ts: event.ts
      });
      return {
        ...state,
        events: appendEvent(state.events, event, mutate),
        subagents: { ...state.subagents, [event.subagentId]: { ...cur, steps } }
      };
    }
    case 'file-edit': {
      const eventsNext = appendEvent(state.events, event, mutate);
      // Maintain per-runId counts. Both orchestrator-level and
      // sub-agent-level edits inherit the same `runId` (sub-agents are
      // launched from a parent run), so a single counter slot captures
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
      if (!event.subagentId) {
        return { ...state, events: eventsNext, runIdToFileEditCount };
      }
      const cur = ensureSnapshot(state.subagents, event.subagentId, event.ts);
      const fileEdits = [
        ...cur.fileEdits,
        {
          key: event.id,
          filePath: event.filePath,
          additions: event.additions,
          deletions: event.deletions,
          ts: event.ts
        }
      ];
      return {
        ...state,
        events: eventsNext,
        runIdToFileEditCount,
        subagents: { ...state.subagents, [event.subagentId]: { ...cur, fileEdits } }
      };
    }

    case 'token-usage': {
      // Per-turn usage report. Route to the sub-agent aggregate when
      // `subagentId` is present; otherwise fold into the orchestrator
      // aggregate. Not appended to `events` — it is metadata that the
      // UI consumes through the dedicated aggregates, and persisting it
      // is still useful on transcript rebuild (handled below).
      const eventsNext = appendEvent(state.events, event, mutate);
      if (event.subagentId) {
        const cur = ensureSnapshot(state.subagents, event.subagentId, event.ts);
        const usage = foldTokenUsage(cur.usage, event.usage);
        return {
          ...state,
          events: eventsNext,
          subagents: {
            ...state.subagents,
            [event.subagentId]: { ...cur, usage }
          }
        };
      }
      return {
        ...state,
        events: eventsNext,
        orchestratorUsage: foldTokenUsage(state.orchestratorUsage, event.usage)
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
      // Routing rules:
      //   - When `detail.subagentId` is present and the snapshot is
      //     non-terminal, fold into `subagent.liveStatus` so the
      //     per-worker trace card carries its own shimmer.
      //   - Otherwise the event is orchestrator-scoped: store it in
      //     `latestOrchestratorRunStatus` for `LiveStatusRow` to read
      //     directly (O(1) lookup, no event scan).
      const subId = event.detail?.subagentId;
      if (subId && state.subagents[subId]) {
        const cur = state.subagents[subId]!;
        // Do NOT re-set liveStatus on terminal snapshots — a late event
        // should never resurrect a settled row.
        if (cur.status === 'done' || cur.status === 'failed' || cur.status === 'aborted') {
          return state;
        }
        const next: SubAgentSnapshot = {
          ...cur,
          liveStatus: { phase: event.phase, label: event.label, ts: event.ts }
        };
        return {
          ...state,
          subagents: { ...state.subagents, [subId]: next }
        };
      }
      // Orchestrator-scoped (or sub-agent-scoped event whose snapshot
      // doesn't exist yet — extremely rare but defended against by
      // routing into the orchestrator slot in that case too).
      if (subId) {
        // Snapshot missing; the event has nowhere to land. Drop it
        // rather than overwriting the orchestrator's status with a
        // sub-agent's stale phase.
        return state;
      }
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
      return {
        ...state,
        events: appendEvent(state.events, event, mutate),
        lastUserPromptId: event.id,
        lastUserPromptContent: event.content,
        settledCallIds: {}
      };
    case 'agent-thought':
    case 'phase':
    case 'error':
      return { ...state, events: appendEvent(state.events, event, mutate) };

    case 'checkpoint-entry':
    case 'checkpoint-revert':
    case 'checkpoint-bash-mutation':
      // Checkpoint events are persisted into the transcript so
      // replay reconstructs the same audit trail the live run had.
      // The LIVE timeline reducer just appends — the dedicated
      // pending-changes panel and Checkpoints view consume them
      // through `useCheckpointsStore`, not through derived rows.
      // (See `deriveRows.ts` for the matching skip.)
      return { ...state, events: appendEvent(state.events, event, mutate) };

    case 'diff-stream': {
      // Phase 2 — main-process FS-aware live diff. Folds into the
      // matching `partialToolCallArgs` entry's `diffStream` slot so
      // the existing partial-tool-group rendering picks it up
      // alongside the renderer-side synthesised preview. Cumulative
      // semantics (latest event for a callId supersedes earlier
      // ones) match the `tool-call-args-delta` lifecycle.
      //
      // Routing rules mirror the args-delta path:
      //   - `subagentId` set + matching snapshot exists → fold into
      //     that snapshot's `partialToolCallArgs[callId]`.
      //   - otherwise → fold into the orchestrator-level slot.
      //
      // If the partial entry doesn't exist yet (the diff-stream
      // beat the first args-delta — possible when the model emitted
      // the call name + args in a single frame), seed a minimal
      // entry so the diff still renders. The args-delta that lands
      // afterwards merges with the existing entry.
      //
      // Audit fix H3: drop late frames that race the synchronous
      // `tool-call` dispatch. The settle re-emit (audit fix H8)
      // intentionally lands BEFORE `tool-call` and is therefore
      // accepted (the settledCallIds gate hasn't fired yet); any
      // frame after the tool-call is a stale leftover from an
      // in-flight LCS compute and would resurrect an orphan
      // partial entry that survives until the next event.
      if (state.settledCallIds[event.callId]) return state;
      const snapshot = {
        tool: event.tool,
        filePath: event.filePath,
        hunks: event.hunks,
        additions: event.additions,
        deletions: event.deletions,
        settled: event.settled === true,
        ts: event.ts
      };
      if (event.subagentId) {
        const cur = state.subagents[event.subagentId];
        if (!cur) return state; // drop diff-stream for unknown sub-agents
        const existing = cur.partialToolCallArgs[event.callId];
        const nextEntry: PartialToolCallArgs = existing
          ? { ...existing, diffStream: snapshot, ts: event.ts }
          : {
            callId: event.callId,
            index: 0,
            argsBuf: '',
            parsed: null,
            ts: event.ts,
            subagentId: event.subagentId,
            diffStream: snapshot
          };
        return {
          ...state,
          subagents: {
            ...state.subagents,
            [event.subagentId]: {
              ...cur,
              partialToolCallArgs: {
                ...cur.partialToolCallArgs,
                [event.callId]: nextEntry
              }
            }
          }
        };
      }
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
        }
      };
    }

    case 'tool-call-args-delta': {
      // Streaming partial-args preview. Fold the cumulative buffer
      // into `partialToolCallArgs` (orchestrator-level) or the
      // matching sub-agent snapshot. We DON'T append the event to
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
      const entry: PartialToolCallArgs = {
        callId: event.callId,
        ...(event.name !== undefined ? { name: event.name } : {}),
        index: event.index,
        argsBuf: event.argsBuf,
        parsed,
        ts: event.ts,
        ...(event.subagentId !== undefined ? { subagentId: event.subagentId } : {})
      };
      if (event.subagentId) {
        // Audit fix M-18: auto-create the snapshot if the args-delta
        // arrives before the matching `subagent-pending` / `-spawn`
        // event (rare but possible under IPC reordering). Previously
        // this branch silently dropped — the live partial-args
        // preview was invisible until the authoritative `tool-call`
        // landed. `ensureSnapshot` is the same fail-soft synthesis
        // the `tool-call` branch uses (see line ~715), so the
        // sub-agent's eventual `subagent-pending` event will merge
        // into the already-materialised snapshot.
        const cur = ensureSnapshot(state.subagents, event.subagentId, event.ts);
        const nextSnap: SubAgentSnapshot = {
          ...cur,
          partialToolCallArgs: {
            ...cur.partialToolCallArgs,
            [event.callId]: entry
          }
        };
        return {
          ...state,
          subagents: { ...state.subagents, [event.subagentId]: nextSnap }
        };
      }
      return {
        ...state,
        partialToolCallArgs: {
          ...state.partialToolCallArgs,
          [event.callId]: entry
        }
      };
    }

    case 'context-summary-pending': {
      // Open a fresh accumulator for this summaryId. Replay-safe:
      // a duplicate `pending` for the same id (impossible in
      // practice — the orchestrator mints one UUID per call)
      // would simply replace the prior entry.
      const acc = {
        summaryId: event.summaryId,
        startedAt: event.ts,
        range: event.range,
        replacedMessageIds: event.replacedMessageIds,
        droppedMessageIds: event.droppedMessageIds,
        beforeTokens: event.beforeTokens,
        config: event.config,
        text: '',
        reasoningText: '',
        status: 'pending' as const,
        undone: false
      };
      return {
        ...state,
        events: appendEvent(state.events, event, mutate),
        summaries: { ...state.summaries, [event.summaryId]: acc }
      };
    }

    case 'context-summary-delta': {
      const prev = state.summaries[event.summaryId];
      // Late delta after `-end` / `-aborted` / no `-pending` —
      // ignore. Mirrors the agent-text-delta tombstone behaviour.
      if (!prev) return state;
      if (prev.status === 'ended' || prev.status === 'aborted') return state;
      const next = {
        ...prev,
        text: prev.text + event.delta,
        status: 'streaming' as const,
        ...(prev.textStartedAt === undefined ? { textStartedAt: event.ts } : {})
      };
      return {
        ...state,
        events: appendEvent(state.events, event, mutate),
        summaries: { ...state.summaries, [event.summaryId]: next }
      };
    }

    case 'context-summary-reasoning-delta': {
      const prev = state.summaries[event.summaryId];
      if (!prev) return state;
      if (prev.status === 'ended' || prev.status === 'aborted') return state;
      const next = {
        ...prev,
        reasoningText: prev.reasoningText + event.delta,
        status: prev.status === 'pending' ? ('streaming' as const) : prev.status,
        ...(prev.reasoningStartedAt === undefined
          ? { reasoningStartedAt: event.ts }
          : {})
      };
      return {
        ...state,
        events: appendEvent(state.events, event, mutate),
        summaries: { ...state.summaries, [event.summaryId]: next }
      };
    }

    case 'context-summary-end': {
      const prev = state.summaries[event.summaryId];
      // No matching `-pending` ⇒ the transcript is malformed.
      // Persist the event for transparency but skip the
      // accumulator update so the renderer doesn't synthesize a
      // phantom row from an `-end` alone.
      if (!prev) {
        return { ...state, events: appendEvent(state.events, event, mutate) };
      }
      const next = {
        ...prev,
        status: 'ended' as const,
        finalText: event.finalText,
        afterTokens: event.afterTokens,
        savedPercent: event.savedPercent
      };
      return {
        ...state,
        events: appendEvent(state.events, event, mutate),
        summaries: { ...state.summaries, [event.summaryId]: next }
      };
    }

    case 'context-summary-aborted': {
      const prev = state.summaries[event.summaryId];
      if (!prev) {
        return { ...state, events: appendEvent(state.events, event, mutate) };
      }
      const next = {
        ...prev,
        status: 'aborted' as const,
        reason: event.reason
      };
      return {
        ...state,
        events: appendEvent(state.events, event, mutate),
        summaries: { ...state.summaries, [event.summaryId]: next }
      };
    }

    case 'context-summary-undone': {
      const prev = state.summaries[event.summaryId];
      if (!prev) {
        return { ...state, events: appendEvent(state.events, event, mutate) };
      }
      const next = { ...prev, undone: true };
      return {
        ...state,
        events: appendEvent(state.events, event, mutate),
        summaries: { ...state.summaries, [event.summaryId]: next }
      };
    }

    case 'context-override-set': {
      // Three semantics on this event variant:
      //   - `messageId === '*'`           → wipe ALL overrides
      //   - `override === null` (per id)  → clear that one override
      //   - both set                      → set the override
      // Mirrors the main-side `overrideStore.applyOverrideEvent`
      // logic so reducer + main store agree on the resolved map.
      let nextOverrides: Record<string, import('@shared/types/contextSummary.js').ContextMessageOverride>;
      if (event.messageId === '*') {
        nextOverrides = {};
      } else if (event.override === null) {
        if (!(event.messageId in state.messageOverrides)) {
          // Idempotent — nothing changed; keep the same reference
          // so memoized selectors don't re-fire.
          return { ...state, events: appendEvent(state.events, event, mutate) };
        }
        const { [event.messageId]: _drop, ...rest } = state.messageOverrides;
        void _drop;
        nextOverrides = rest;
      } else {
        if (state.messageOverrides[event.messageId] === event.override) {
          return { ...state, events: appendEvent(state.events, event, mutate) };
        }
        nextOverrides = {
          ...state.messageOverrides,
          [event.messageId]: event.override
        };
      }
      return {
        ...state,
        events: appendEvent(state.events, event, mutate),
        messageOverrides: nextOverrides
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
  for (const e of events) s = applyTimelineEvent(s, e, { mutateEvents: true });
  return s;
}

