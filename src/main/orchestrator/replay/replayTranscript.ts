/**
 * Reconstructs the OpenAI-canonical `messages` array from a persisted
 * TimelineEvent stream. This is what restores the orchestrator's memory
 * across turns — without it, every `chat:send` starts from a blank slate.
 *
 * Strategy: walk the timeline in event-order, emitting messages as we go:
 *
 *   - `user-prompt` →
 *       { role:'user', content: <turn>...<user_message>...</user_message></turn> }
 *
 *   - A run of `agent-text-delta`/`agent-reasoning-delta` (same id) plus
 *     any `tool-call` events emitted before the next `user-prompt` →
 *       { role:'assistant', content, reasoning_content?, tool_calls? }
 *
 *   - Each `tool-result` immediately following its assistant turn →
 *       { role:'tool', tool_call_id, name, content }
 *
 *   - A run of subagent-spawn / -status / -result →
 *       { role:'user', content: <subagent_results>…</subagent_results> }
 *     (sub-agent tool-call/-result events are SKIPPED because sub-agents
 *      run with isolated contexts — only their final verified result is
 *      visible to the orchestrator)
 *
 *   - `phase`, `agent-thought`, `error` → skipped (UI-only, not model
 *      memory).
 */

import type { ChatMessage, TimelineEvent } from '@shared/types/chat.js';
import { MAX_TOOL_OUTPUT_CHARS } from '@shared/constants.js';
import { wrapXml, buildSubagentResultsEnvelope } from '../envelope/index.js';

export function replayTranscript(events: TimelineEvent[]): ChatMessage[] {
  // Audit fix §2.2 — pre-pass: collect every event id masked by ANY
  // `history-summary` event in the transcript. The main pass below
  // skips persisted events whose id appears in this set so the
  // orchestrator's reconstructed view matches the compacted view the
  // live run produced. The summary itself is injected at the
  // `history-summary` event's position (see the `history-summary`
  // case below).
  const maskedIds = new Set<string>();
  for (const e of events) {
    if (e.kind === 'history-summary') {
      for (const id of e.replacedEventIds) maskedIds.add(id);
    }
  }

  const messages: ChatMessage[] = [];

  // Walking state for the in-progress assistant turn.
  let curAssistantId: string | null = null;
  let curText = '';
  let curReasoning = '';
  let curToolCalls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> = [];
  // We must emit the assistant message BEFORE the matching tool-result rows,
  // and we must keep a mapping of call id -> name for the role:'tool' rows.
  const toolCallMeta = new Map<string, { name: string }>();
  // FIFO queue of unpaired tool-call ids (within the current assistant turn).
  //
  // Tool-result pairing policy (two-step):
  //   1. If `tool-result.id` matches a still-pending call id, pair by id
  //      and remove that specific id from the queue. This is the correct
  //      behavior for modern transcripts (`handleToolCalls` now stamps
  //      `result.id = callId` from the LLM's tool call) AND it is
  //      resilient to partial persistence: e.g. assistant emits calls
  //      A, B, C and only B's result was persisted before an abort —
  //      id-pairing correctly attaches the result to B, leaving A and C
  //      as orphans for `sanitizeToolCallPairing` to stub.
  //   2. Otherwise fall back to FIFO (the OLDEST unpaired call). This is
  //      the heal path for LEGACY transcripts where the tool runner was
  //      allowed to mint its own `result.id` and the id drifted away
  //      from the original `call.id`. Order is the best signal we have
  //      in that case.
  let pendingCallIds: string[] = [];

  // Sub-agent round buffers.
  //
  // Replay shape: a delegation round may emit `subagent-spawn`,
  // `subagent-status` (multiple), and `subagent-result`. An aborted run
  // can stop at spawn/status with NO `subagent-result` — the previous
  // implementation lost that round entirely (spawn/status flipped the
  // `inSubagentRound` flag but only `subagent-result` produced an entry).
  // We now track every spawned id in insertion order and synthesize a
  // status="aborted" placeholder if no result ever arrives, so the
  // orchestrator's persisted memory stays faithful to what actually
  // happened on the wire.
  let inSubagentRound = false;
  let roundSpawnOrder: string[] = [];
  const roundEntries = new Map<string, { status?: string; output: string }>();
  /** Tracks the LATEST status seen for a sub-agent id across the whole
   *  transcript. Used so a `subagent-result` always pairs with the most
   *  recent status, not the first one (`events.find(...)` was finding the
   *  wrong status when an id was re-spawned across rounds). */
  const latestStatusByAgent = new Map<string, string>();

  const flushAssistant = () => {
    if (curAssistantId === null) return;
    if (curText.length === 0 && curReasoning.length === 0 && curToolCalls.length === 0) {
      curAssistantId = null;
      return;
    }
    const msg: ChatMessage = {
      role: 'assistant',
      content: curText.length === 0 && curToolCalls.length > 0 ? null : curText
    };
    if (curReasoning.length > 0) msg.reasoning_content = curReasoning;
    if (curToolCalls.length > 0) msg.tool_calls = curToolCalls;
    messages.push(msg);
    curAssistantId = null;
    curText = '';
    curReasoning = '';
    curToolCalls = [];
  };

  const flushSubagentRound = () => {
    if (!inSubagentRound) return;
    if (roundSpawnOrder.length > 0) {
      const envelope = buildSubagentResultsEnvelope(
        roundSpawnOrder.map((id) => {
          const entry = roundEntries.get(id) ?? { output: '' };
          // Status precedence: explicit per-entry status (set on
          // subagent-result) → most-recent status seen → 'aborted' fallback
          // when the round ended without a result event.
          const status =
            entry.status ?? latestStatusByAgent.get(id) ?? 'aborted';
          const attrs: Record<string, string> = { status };
          // The persisted output is the raw assistant text from the
          // sub-agent (often containing a `<result>…</result>` block).
          // Trim large bodies so we don't bloat replay context.
          const raw = entry.output;
          const inner =
            raw.length > MAX_TOOL_OUTPUT_CHARS
              ? truncateUtf8Safe(raw, MAX_TOOL_OUTPUT_CHARS) + '\n…[truncated]'
              : raw.length > 0
                ? raw
                : '<status>aborted</status>\n<summary>(no result emitted before round closed)</summary>';
          return { id, attrs, inner };
        })
      );
      messages.push({ role: 'user', content: envelope });
    }
    inSubagentRound = false;
    roundSpawnOrder = [];
    roundEntries.clear();
    // Any tool-call ids still unpaired at this boundary belonged to an
    // assistant turn that never received its tool-result. Drop them so
    // they can't bleed into the next turn (mirrors the user-prompt
    // boundary cleanup).
    pendingCallIds = [];
  };

  for (const e of events) {
    // Audit fix §2.2 — skip events masked by an earlier (in event
    // order) `history-summary`. The summary itself is replayed when
    // we hit its sentinel below, so the orchestrator's reconstructed
    // `messages[]` reads `…sys, summary, recent turns, current
    // prompt` — the same shape the live run sent.
    if (maskedIds.has(e.id)) continue;
    switch (e.kind) {
      case 'history-summary': {
        // Synthetic user message that stands in for everything
        // collapsed into the summary. The XML wrapper matches what
        // the live run injects (see `runLoop.ts` summarizer block)
        // so the orchestrator can recognize / re-cite the summary.
        flushAssistant();
        flushSubagentRound();
        pendingCallIds = [];
        messages.push({
          role: 'user',
          content: `<history_summary>\n${e.summary}\n</history_summary>`
        });
        break;
      }
      case 'user-prompt': {
        flushAssistant();
        flushSubagentRound();
        // Any tool-call ids still unpaired at this boundary are stale —
        // they belonged to a previous turn that never received its
        // matching tool-result events. Drop them so they can't bleed
        // into the next assistant turn.
        pendingCallIds = [];
        const content =
          wrapXml('turn', wrapXml('user_message', e.content, undefined, { escape: true }));
        messages.push({ role: 'user', content });
        break;
      }
      case 'agent-text-delta':
      case 'agent-reasoning-delta': {
        // Sub-agent-scoped streaming text/reasoning is UI-only — the
        // orchestrator's reconstructed `messages` array must NOT
        // include a worker's chain-of-thought (sub-agent contexts are
        // explicitly isolated; only the verified `<result>` envelope
        // is replayed via the `<subagent_results>` re-injection
        // below). Skip the event so its body never leaks into
        // `curText` / `curReasoning`. Audit fix §1.1.
        if (e.subagentId) break;
        if (curAssistantId !== e.id) {
          flushAssistant();
          curAssistantId = e.id;
        }
        if (e.kind === 'agent-text-delta') curText += e.delta;
        else curReasoning += e.delta;
        break;
      }
      case 'agent-text-aborted': {
        // Sub-agent-scoped abort: UI-only signal. Audit fix §1.1.
        if (e.subagentId) break;
        // Abandon the in-progress assistant text/reasoning for this id.
        if (curAssistantId === e.id) {
          curAssistantId = null;
          curText = '';
          curReasoning = '';
          // Tool calls collected for the SAME assistant id stay valid only
          // if they were already paired with results (rare case for an
          // aborted text turn). Drop them to be safe.
          curToolCalls = [];
          // Defensive sweep symmetric with the user-prompt boundary:
          // any unpaired call ids belonged to the aborted turn we just
          // dropped. Leaving them in `pendingCallIds` would let a later
          // `tool-result` pair against a stale id from a turn we've
          // already discarded. In practice the orchestrator never
          // persists `tool-call` events for a turn that aborted before
          // `handleAssistantTurn` returned successfully, so this is
          // unreachable today — but the symmetry closes the gap if a
          // future change persists tool-call events earlier in the
          // emit pipeline.
          pendingCallIds = [];
        }
        break;
      }
      case 'agent-text-end':
      case 'agent-reasoning-end':
        // Pure markers — no model-side effect. The text already lives in
        // the buffers; we keep accumulating until the next non-streaming
        // event arrives. Sub-agent-scoped markers (Audit fix §1.1) are
        // similarly invisible to the model — the orchestrator only sees
        // the worker's final `<result>` envelope.
        break;
      case 'tool-call': {
        if (e.subagentId) break; // sub-agent internals are isolated
        // Tool calls belong to the in-progress assistant turn.
        if (curAssistantId === null) curAssistantId = `call-anchor-${e.id}`;
        curToolCalls.push({
          id: e.call.id,
          type: 'function',
          function: { name: e.call.name, arguments: JSON.stringify(e.call.args ?? {}) }
        });
        toolCallMeta.set(e.call.id, { name: e.call.name });
        pendingCallIds.push(e.call.id);
        break;
      }
      case 'tool-result': {
        if (e.subagentId) break;
        // Flush the assistant turn that spawned this call (if any).
        flushAssistant();
        // Pairing policy: see the `pendingCallIds` comment. Prefer an
        // id-based match (modern transcripts + partial-persistence
        // resilience), fall back to FIFO (legacy transcripts where the
        // tool runner minted its own result.id).
        let callId: string;
        const idMatchIdx = pendingCallIds.indexOf(e.result.id);
        if (idMatchIdx !== -1) {
          pendingCallIds.splice(idMatchIdx, 1);
          callId = e.result.id;
        } else {
          callId = pendingCallIds.shift() ?? e.result.id;
        }
        const meta = toolCallMeta.get(callId);
        const output = truncateUtf8Safe(e.result.output, MAX_TOOL_OUTPUT_CHARS);
        messages.push({
          role: 'tool',
          tool_call_id: callId,
          name: meta?.name ?? e.result.name,
          content: output
        });
        break;
      }
      case 'subagent-spawn': {
        flushAssistant();
        inSubagentRound = true;
        if (!roundEntries.has(e.subagentId)) {
          roundSpawnOrder.push(e.subagentId);
          roundEntries.set(e.subagentId, { output: '' });
        }
        break;
      }
      case 'subagent-status': {
        flushAssistant();
        inSubagentRound = true;
        latestStatusByAgent.set(e.subagentId, e.status);
        const cur = roundEntries.get(e.subagentId);
        if (cur) {
          cur.status = e.status;
        } else {
          roundSpawnOrder.push(e.subagentId);
          roundEntries.set(e.subagentId, { output: '', status: e.status });
        }
        break;
      }
      case 'subagent-result': {
        flushAssistant();
        inSubagentRound = true;
        const cur = roundEntries.get(e.subagentId);
        if (cur) {
          cur.output = e.output;
          if (cur.status === undefined) {
            const latest = latestStatusByAgent.get(e.subagentId);
            if (latest !== undefined) cur.status = latest;
          }
        } else {
          roundSpawnOrder.push(e.subagentId);
          const entry: { status?: string; output: string } = { output: e.output };
          const latest = latestStatusByAgent.get(e.subagentId);
          if (latest !== undefined) entry.status = latest;
          roundEntries.set(e.subagentId, entry);
        }
        break;
      }
      case 'phase':
      case 'agent-thought':
      case 'file-edit':
      case 'error':
      case 'subagent-pending':
      case 'token-usage':
        // UI-only events; intentionally absent from model memory.
        // `subagent-pending` is a renderer-only signal that the directive
        // has been parsed mid-stream — the matching `subagent-spawn` /
        // `subagent-result` events carry the model-visible state.
        break;
      default:
        // Defensive: ignore unknown shapes gracefully.
        break;
    }
  }
  flushAssistant();
  flushSubagentRound();
  return messages;
}

/**
 * Truncate a string to at most `maxChars` code units WITHOUT leaving a
 * torn UTF-8/UTF-16 boundary at the cut.
 *
 * `String.prototype.slice` operates on UTF-16 code units, so a cut that
 * lands inside a surrogate pair (most emoji, many CJK-adjacent codepoints)
 * leaves a lone high-surrogate that most downstream serializers render as
 * `\uFFFD`. We first trim the lone surrogate, then round-trip through
 * `Buffer` with its utf-8 coder which also replaces any incidentally-
 * torn multi-byte sequence with a single `\uFFFD` replacement character —
 * the model sees clean text regardless of where the cap landed.
 */
function truncateUtf8Safe(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s;
  let cut = maxChars;
  // If the last surviving code unit is a lone high surrogate, drop it so
  // we never emit an unpaired surrogate across the cut.
  const lastCode = s.charCodeAt(cut - 1);
  if (lastCode >= 0xd800 && lastCode <= 0xdbff) cut -= 1;
  const head = s.slice(0, cut);
  // Round-trip through utf-8 to normalize any stray malformed bytes at
  // the boundary. Buffer's decoder replaces them with U+FFFD.
  return Buffer.from(head, 'utf8').toString('utf8');
}
