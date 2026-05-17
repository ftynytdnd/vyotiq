/**
 * Message-window partitioner.
 *
 * The orchestrator's `messages: ChatMessage[]` array carries
 * heterogeneous entries — system placeholder, replayed history,
 * fresh user turn, multi-iteration assistant turns, tool-call
 * messages, paired tool-result messages, sub-agent verdicts, and
 * (recursively) prior `<context_summary>` envelopes. Compression
 * has to operate on a CONTIGUOUS sub-range so the wire shape
 * stays valid: every `assistant.tool_calls` MUST be followed by
 * the matching `role:'tool'` reply or strict-OpenAI providers
 * (DeepSeek, OpenAI, OpenRouter) reject the next request with
 * `insufficient tool messages following tool_calls message`.
 *
 * This module is the single source of truth for that decision. It
 * partitions `messages` into three index sets — `preserved`,
 * `summarizable`, `dropped` — by walking the array left to right
 * and applying the user's `ContextSummaryRules` plus per-message
 * overrides. The orchestrator's loop never reasons about indices
 * directly; it consumes the partition from here.
 *
 * Pure / deterministic / no I/O. Cheap to call per iteration.
 */

import { createHash } from 'node:crypto';
import type { ChatMessage } from '@shared/types/chat.js';
import type {
  ContextMessageOverride,
  ContextSummaryRules,
  MessageKind
} from '@shared/types/contextSummary.js';

/**
 * Sentinel `messageId` used by `setMessageOverride('*')` to clear
 * every override on a conversation in a single event. Re-exported
 * here so the partition function and the override store agree on
 * the value without a circular dep.
 */
export const RESET_ALL_OVERRIDES_SENTINEL = '*';

/**
 * Heuristic threshold (chars) under which the `'auto'` per-kind
 * policy preserves an entry verbatim. Picked so a one-or-two-line
 * tool result (a `read` of a 200-byte file, an `ls` of a small
 * folder) stays inline — these are not the bottleneck even on a
 * long run. `delegate-result` and large `tool-result` entries blow
 * past this comfortably and become the primary compression target.
 *
 * Internal — not exported. Tunable here without touching constants.
 */
const AUTO_KEEP_CHAR_THRESHOLD = 512;

/**
 * Stable, deterministic per-message identity used by both the
 * Inspector and the persisted `context-override-set` events.
 *
 * The orchestrator's `messages[]` is mutated in place across
 * iterations (system slot rewritten, new turns appended), so a
 * positional id (`msg-0`, `msg-1`) would shift under us and a
 * Saved override would attach to the wrong row on the next turn.
 * We need an id that is:
 *   - **Content-stable** — re-deriving from the same `ChatMessage`
 *     produces the same id, no matter how many other entries
 *     surround it.
 *   - **Order-stable** — two messages with identical content but
 *     different positions in the array still get DIFFERENT ids,
 *     so the Inspector renders them as separate rows the user
 *     can toggle independently.
 *   - **Cheap** — derived per call, no per-run state to GC.
 *
 * Implementation: a streaming SHA-256 over `(role, content?,
 * tool_call_id?, name?, tool_calls(canonicalized)?, index)`. The
 * `index` term makes it order-stable; everything else is content.
 * 12 base64url chars (~72 bits) is plenty of collision resistance
 * for any realistic conversation length.
 *
 * Internal — callers consume `identifyAll` (parallel-array form);
 * keeping the per-message helper file-local prevents the rest of
 * the module from drifting toward an O(N²) re-hash-per-lookup
 * pattern.
 */
function identifyMessage(msg: ChatMessage, index: number): string {
  const h = createHash('sha256');
  h.update(`i:${index}\u0000r:${msg.role}\u0000`);
  if (msg.content !== null && msg.content !== undefined) {
    h.update(`c:${msg.content}\u0000`);
  } else {
    h.update('c:!null\u0000');
  }
  if (typeof msg.tool_call_id === 'string') h.update(`tci:${msg.tool_call_id}\u0000`);
  if (typeof msg.name === 'string') h.update(`n:${msg.name}\u0000`);
  if (Array.isArray(msg.tool_calls)) {
    for (const tc of msg.tool_calls) {
      h.update(`tc:${tc.id}|${tc.function.name}|${tc.function.arguments}\u0000`);
    }
  }
  return h.digest('base64url').slice(0, 12);
}

/**
 * Compute stable ids for the entire array in one pass. Returned
 * array is index-aligned with `messages` so `ids[i]` is the id of
 * `messages[i]`. Helpers in this file consume the parallel array
 * everywhere instead of re-hashing on each lookup.
 */
export function identifyAll(messages: ReadonlyArray<ChatMessage>): string[] {
  return messages.map((m, i) => identifyMessage(m, i));
}

/**
 * Marker the orchestrator's `buildSubagentResultsEnvelope` always
 * emits at position 0 of the synthetic `role:'user'` message it
 * injects after a delegation round resolves. Anchored to start-
 * of-content so a real user prompt mentioning the literal
 * substring stays classified as `'user'`.
 *
 * Internal — the public surface is `classifyMessage`. Hard-coded
 * here rather than imported from `envelope/buildSubagentResultsEnvelope`
 * to avoid a circular dep and because the marker is part of the
 * wire shape contract; a `wrapXml('subagent_results', …)` produces
 * `<subagent_results>\n…\n</subagent_results>` which starts with
 * `<subagent_results`.
 *
 * (The `delegate-result` MessageKind name predates the envelope
 * rename and is kept for backward compatibility with the
 * persisted `perKindPolicy` shape in user settings.)
 */
const SUBAGENT_RESULTS_MARKER = '<subagent_results';

/**
 * Coarse classification of a single `ChatMessage` into a
 * `MessageKind`. Mirrors the harness §A `<message kind>` taxonomy
 * the summarizer reads.
 *
 *   - `role:'user'` is `'user'` UNLESS its content opens with
 *     `<subagent_results` — those are the orchestrator-injected
 *     verified envelopes returned from sub-agent rounds, which the
 *     harness teaches the summarizer to treat as a dedicated kind
 *     (`'delegate-result'`) so the per-kind policy can compress
 *     them aggressively without dropping real user prompts.
 *   - `role:'assistant'` with non-empty `tool_calls` is
 *     `'assistant-tool-call'`; pure-text assistant turns are
 *     `'assistant'`.
 *   - `role:'tool'` is `'tool-result'`.
 *   - `role:'system'` whose content is a `<context_summary>`
 *     envelope is `'system-summary'`. The first system slot
 *     (harness + envelopes) classifies as `'system-summary'` too —
 *     but the partitioner ALWAYS flags index 0 as preserved when
 *     `preserveFirstSystem` is true, so the classification of that
 *     slot never matters in practice. We still tag non-summary
 *     system slots as `'system-summary'` for clarity (defensive:
 *     should not appear in a healthy run beyond index 0).
 */
export function classifyMessage(msg: ChatMessage): MessageKind {
  if (msg.role === 'system') return 'system-summary';
  if (msg.role === 'tool') return 'tool-result';
  if (msg.role === 'assistant') {
    if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      return 'assistant-tool-call';
    }
    return 'assistant';
  }
  // role === 'user'
  //
  // M5: anchor the marker check to position 0 of the content. The
  // orchestrator's `buildSubagentResultsEnvelope` ALWAYS emits the
  // `<subagent_results>` envelope at the start of the synthetic
  // user message it injects after a delegation round — there is
  // never a leading prose preamble (Prime Directives §6 boundary
  // — the harness can't trust prose-then-data shapes).
  //
  // The previous implementation looked for `<delegate_result` with
  // `.includes(...)`, which:
  //   1. NEVER matched in practice — the actual envelope tag is
  //      `<subagent_results>`. Every synthesized round-result
  //      envelope was misclassified as plain `'user'`, bypassing
  //      the `'delegate-result'` per-kind policy entirely.
  //   2. Could (in principle) misclassify a legitimate user
  //      prompt that happened to mention the literal substring.
  //
  // Fixing both at once: correct marker AND anchored prefix.
  const content = msg.content ?? '';
  if (typeof content === 'string' && content.startsWith(SUBAGENT_RESULTS_MARKER)) {
    return 'delegate-result';
  }
  return 'user';
}

/**
 * Result of the partition pass. Consumers iterate `summarizable`
 * to build the summarizer prompt body, splice
 * `[summarizable[0], summarizable.at(-1)! + 1)` once the summary
 * lands, and surface `dropped` to the renderer for the
 * Inspector's "Dropped" section.
 *
 * The partition is half-open at both ends in spirit but encoded
 * as a sorted index array (not a range tuple) because the
 * dropped set may interleave with the summarizable set when the
 * user marks a single mid-window message as `'drop'`.
 *
 * IMPORTANT: when `dropped` interleaves with `summarizable`, the
 * splice still operates on the contiguous range
 * `[firstSummarizable, lastSummarizable + 1)`. Dropped messages
 * inside that range are folded into the splice (removed from the
 * orchestrator's `messages[]`) but their content is NOT included
 * in the summarizer's input — the summary's `droppedMessageIds`
 * field carries them as audit-only. See `streamSummary.ts` for
 * the body assembly.
 */
export interface MessageWindowPartition {
  /** Indices preserved verbatim. Sorted ascending. */
  preserved: number[];
  /** Indices that go into the summarizer's input. Sorted ascending. */
  summarizable: number[];
  /** Indices the user explicitly marked `'drop'`. Sorted ascending. */
  dropped: number[];
  /** Stable per-message ids parallel to `messages`. */
  ids: string[];
  /** Per-index kind classification (memoized once for the partition). */
  kinds: MessageKind[];
}

/**
 * Compute the partition.
 *
 *   1. Always preserve the first system slot when
 *      `rules.preserveFirstSystem` is true (default).
 *   2. Always preserve the most-recent N "turns" (a turn is the
 *      span ending at a `role:'user'` message).
 *   3. For every middle index, resolve the effective decision:
 *        - explicit per-message override wins over kind policy;
 *        - kind policy `'keep'` → preserved; `'drop'` → dropped;
 *          `'summarize'` → summarizable; `'auto'` → preserved
 *          when `charCount < AUTO_KEEP_CHAR_THRESHOLD`, else
 *          summarizable;
 *        - `rules.preserveUserPromptsAlways` upgrades any `'user'`
 *          entry to preserved when no explicit override is set.
 *   4. Apply the **tool-call ↔ tool-result pairing invariant**:
 *      an `assistant-tool-call` and EVERY `tool-result` that
 *      answers it MUST be in the same partition. If any answer
 *      is preserved, the call AND every other answer for the
 *      same call are pulled into preserved; if every answer is
 *      summarizable, the call follows them. This guarantees the
 *      next request's wire shape stays valid.
 *
 * The returned partition is index-disjoint
 * (`preserved ∪ summarizable ∪ dropped` covers `[0, messages.length)`
 * exactly once each).
 */
export function partition(
  messages: ReadonlyArray<ChatMessage>,
  rules: ContextSummaryRules,
  overrides: Readonly<Record<string, ContextMessageOverride>>
): MessageWindowPartition {
  const ids = identifyAll(messages);
  const kinds = messages.map((m) => classifyMessage(m));

  // Initial decision array. `'preserve'` / `'summarize'` / `'drop'`.
  // We refine in two passes: rules pass + pairing pass.
  type Decision = 'preserve' | 'summarize' | 'drop';
  const decisions: Decision[] = new Array(messages.length).fill('preserve');

  // ── Tail preservation: most-recent N "turns" ────────────────────
  const tailPreservedSet = computeTailPreservedSet(messages, kinds, rules.keepRecentTurns);

  // ── Index-by-index rule application ─────────────────────────────
  for (let i = 0; i < messages.length; i++) {
    // Index 0 + first system slot ⇒ always preserved when the rule
    // is on. The orchestrator rebuilds it per-iteration so summarizing
    // it is meaningless.
    if (i === 0 && messages[i]?.role === 'system' && rules.preserveFirstSystem) {
      decisions[i] = 'preserve';
      continue;
    }
    // Tail-preserved slots take precedence over kind policy (matches
    // the natural "always show the user the last 4 turns" expectation).
    if (tailPreservedSet.has(i)) {
      decisions[i] = 'preserve';
      continue;
    }

    const id = ids[i]!;
    const kind = kinds[i]!;
    const override = overrides[id];

    if (override === 'keep') {
      decisions[i] = 'preserve';
      continue;
    }
    if (override === 'drop') {
      decisions[i] = 'drop';
      continue;
    }
    if (override === 'summarize') {
      decisions[i] = 'summarize';
      continue;
    }

    // No explicit override — apply the kind policy, with the
    // `preserveUserPromptsAlways` rule overlaid on the `'user'` kind.
    if (kind === 'user' && rules.preserveUserPromptsAlways) {
      decisions[i] = 'preserve';
      continue;
    }
    const policy = rules.perKindPolicy[kind];
    if (policy === 'keep') {
      decisions[i] = 'preserve';
    } else if (policy === 'drop') {
      decisions[i] = 'drop';
    } else if (policy === 'summarize') {
      decisions[i] = 'summarize';
    } else {
      // 'auto'
      const m = messages[i]!;
      const text = m.content ?? '';
      const charCount = text.length;
      decisions[i] =
        charCount < AUTO_KEEP_CHAR_THRESHOLD ? 'preserve' : 'summarize';
    }
  }

  // ── Tool-call ↔ tool-result pairing invariant ───────────────────
  // Build a map of callId → { callIdx, resultIdxs[] } so we can
  // reconcile decisions across pairs without re-walking quadratically.
  const callToResults = new Map<
    string,
    { callIdx: number; resultIdxs: number[] }
  >();
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls) {
        const entry = callToResults.get(tc.id) ?? { callIdx: i, resultIdxs: [] };
        entry.callIdx = i;
        callToResults.set(tc.id, entry);
      }
    } else if (m.role === 'tool' && typeof m.tool_call_id === 'string') {
      const entry = callToResults.get(m.tool_call_id) ?? {
        callIdx: -1,
        resultIdxs: []
      };
      entry.resultIdxs.push(i);
      callToResults.set(m.tool_call_id, entry);
    }
  }
  for (const { callIdx, resultIdxs } of callToResults.values()) {
    if (callIdx < 0 || resultIdxs.length === 0) continue;
    // Decision priority for the pair group:
    //   - if ANY member is 'preserve' → ALL members become 'preserve'
    //     (preserving a tool result while summarizing its call would
    //     leave a dangling `role:'tool'` with no preceding tool_calls).
    //   - else if ALL members are 'drop' → leave them all 'drop'.
    //   - otherwise → ALL members become 'summarize' (the safest
    //     migration of a mixed group; drop folds into the splice in
    //     practice since dropped indices inside the summarizable
    //     range are spliced out together).
    const all = [callIdx, ...resultIdxs];
    const anyPreserve = all.some((i) => decisions[i] === 'preserve');
    const allDrop = all.every((i) => decisions[i] === 'drop');
    if (anyPreserve) {
      for (const i of all) decisions[i] = 'preserve';
    } else if (allDrop) {
      // Already 'drop' — leave alone.
    } else {
      for (const i of all) decisions[i] = 'summarize';
    }
  }

  const preserved: number[] = [];
  const summarizable: number[] = [];
  const dropped: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    const d = decisions[i]!;
    if (d === 'preserve') preserved.push(i);
    else if (d === 'summarize') summarizable.push(i);
    else dropped.push(i);
  }
  return { preserved, summarizable, dropped, ids, kinds };
}

/**
 * Compute the set of indices that fall inside the most-recent N
 * turns. A "turn" is anchored by a `role:'user'` message; the span
 * from a user message through the next user message (exclusive)
 * counts as one turn. The very last span (after the last user
 * message) ALWAYS counts as the current turn even when no user
 * message has landed yet (mid-iteration of a fresh run).
 *
 * Returns an empty set when `keepRecentTurns <= 0`.
 *
 * Iteration: walk backward from the tail collecting user-message
 * indices; once we have N (or run out), the preserved range is
 * `[earliestUserIdx, messages.length)`. The first system slot is
 * always treated as preserved by the caller, so we don't need to
 * special-case index 0 here.
 */
function computeTailPreservedSet(
  messages: ReadonlyArray<ChatMessage>,
  _kinds: ReadonlyArray<MessageKind>,
  keepRecentTurns: number
): Set<number> {
  const out = new Set<number>();
  if (keepRecentTurns <= 0 || messages.length === 0) return out;
  // Walk backward, count user messages. We want the index of the
  // (keepRecentTurns)-th most-recent user message; everything from
  // that index to the tail is preserved.
  let userCount = 0;
  let earliestPreservedIdx = messages.length; // sentinel: nothing yet
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') {
      userCount += 1;
      earliestPreservedIdx = i;
      if (userCount >= keepRecentTurns) break;
    }
  }
  // If we never saw a user message, preserve everything from the
  // first non-system index forward (the "current turn" rule).
  if (userCount === 0) {
    earliestPreservedIdx = messages.findIndex((m) => m.role !== 'system');
    if (earliestPreservedIdx < 0) return out;
  }
  for (let i = earliestPreservedIdx; i < messages.length; i++) out.add(i);
  return out;
}
