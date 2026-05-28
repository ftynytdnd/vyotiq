/**
 * Defensive sanitizer that guarantees the tool-call/tool-result pairing
 * invariant strict OpenAI-compat providers (DeepSeek, OpenAI,
 * OpenRouter, Together, …) enforce at the message-shape layer. Two
 * failure modes are handled in one pass:
 *
 *   A. `assistant.tool_calls[i].id` without a matching `role:'tool'`
 *      message before the next assistant turn → provider returns:
 *
 *        "An assistant message with 'tool_calls' must be followed by tool
 *         messages responding to each 'tool_call_id'. (insufficient tool
 *         messages following tool_calls message)"
 *
 *   B. `role:'tool'` message whose `tool_call_id` does NOT match any id
 *      in the most recent assistant message's `tool_calls` → provider
 *      returns:
 *
 *        "Invalid parameter: messages with role 'tool' must be a response
 *         to a preceding message with 'tool_calls'."
 *
 * Sources of orphaning the host can introduce (both directions):
 *
 *   1. `replayTranscript` rebuilds `assistant.tool_calls` and tool
 *      messages from persisted `tool-call` / `tool-result` events. A
 *      prior run that crashed (or used an older build with weaker
 *      pairing) may have persisted one side but lost the other — the
 *      replay then produces an orphan.
 *
 *   2. A mid-stream renderer abort between `tool-call` and `tool-result`
 *      emission, persisted asynchronously to JSONL, can leave the same
 *      gap on next launch.
 *
 *   3. A reducer bug that drops an assistant message while keeping its
 *      tool responses leaves orphan `role:'tool'` rows stranded at the
 *      start of the history.
 *
 * For (A) the sanitizer INJECTS stub `role:'tool'` placeholders so the
 * request shape becomes valid; the model sees a tiny "result was lost"
 * string and proceeds. For (B) the orphan `role:'tool'` message is
 * DROPPED — there is nothing useful to do with a tool result whose
 * call cannot be reconstructed, and forwarding it to the provider is
 * a hard 400. Both fixes are non-destructive to valid shapes: a
 * well-formed transcript passes through unchanged.
 */

import type { ChatMessage } from '@shared/types/chat.js';
import { logger } from '../../logging/logger.js';

const log = logger.child('orchestrator/sanitizeToolPairing');

/**
 * The stub content used when an orphan `tool_call_id` is detected. Kept
 * short and explicit so it doesn't pollute the assistant's reasoning.
 */
const ORPHAN_STUB =
  '(tool result missing — the host could not recover the previous response; ' +
  're-issue the call if you still need the data)';

/**
 * Stats surfaced alongside the sanitized message stream so callers can
 * emit user-visible signals (a `phase` event saying "Recovered N
 * orphan tool_calls in history") without re-walking the messages.
 *
 * Review finding H7: prior to this slot, sanitizer activity was a
 * `log.info` only — the model proceeded correctly under the stubs but
 * the USER saw nothing, even when stub injection fired repeatedly on
 * a broken replay. The orchestrator's `runLoop` now reads
 * `injectedStubs` and emits a single `phase` event so the user has a
 * triage breadcrumb without polluting the timeline with one event per
 * stub.
 */
/** Stats returned by `sanitizeToolCallPairingWithStats` (exported for tests). */
interface SanitizeStats {
  /** Stub `role:'tool'` messages injected after assistants with unpaired `tool_calls`. */
  injectedStubs: number;
  /** Orphan `role:'tool'` messages dropped (no preceding matching `tool_calls[].id`). */
  droppedOrphans: number;
}

export interface SanitizeResult {
  messages: ChatMessage[];
  stats: SanitizeStats;
}

/**
 * Rich variant of `sanitizeToolCallPairing` that also returns the
 * stub/drop counts so callers can surface them via a `phase` event.
 * Production orchestrator path uses this; sub-agents stay on the
 * simple form because their internals are isolated from user-visible
 * timeline events anyway.
 */
export function sanitizeToolCallPairingWithStats(messages: ChatMessage[]): SanitizeResult {
  return sanitizeImpl(messages);
}

/**
 * Returns a NEW message array with:
 *
 *   - Stub `role:'tool'` messages injected after each `assistant` that
 *     had `tool_calls[i].id` values lacking a matching response in the
 *     response block.
 *   - Orphan `role:'tool'` messages (no preceding assistant with a
 *     matching `tool_calls[].id`) filtered out entirely.
 *
 * Stub ordering: stubs for a given assistant message are inserted
 * immediately after that assistant message and before any existing tool
 * messages from the same response block. Strict providers don't
 * require a particular tool order — only that every `tool_call_id`
 * appears once in `role:'tool'` messages within the response block.
 */
export function sanitizeToolCallPairing(messages: ChatMessage[]): ChatMessage[] {
  return sanitizeImpl(messages).messages;
}

function sanitizeImpl(messages: ChatMessage[]): SanitizeResult {
  // Single-pass sanitizer (review finding M5). The legacy
  // implementation was O(N²) on long histories: for every assistant
  // message it ran an inner forward scan to find the next assistant
  // boundary. With 100 assistants in history that was ~5000
  // iterations per `chat:send`. The structure below collapses the
  // walk to one pass:
  //
  //   1. Walk messages forward exactly once.
  //   2. When we see an `assistant`, finalize the PREVIOUS response
  //      block (emit any unresponded stubs for its tool_calls), then
  //      open a fresh response block for the new assistant.
  //   3. Tool messages flush into the current block's `responded`
  //      set IFF their id is in `currentValidIds`; orphans drop.
  //   4. After the loop, finalize the final response block.
  //
  // The closure over `pendingAssistant` / `pendingTools` is shared by
  // the assistant branch and the post-loop finalize so the close-
  // block logic lives in exactly one place.
  const out: ChatMessage[] = [];
  let droppedOrphans = 0;
  let injectedStubs = 0;

  // Open response block state. `null` until the first assistant lands.
  let pendingAssistant: ChatMessage | null = null;
  let pendingValidIds: Set<string> = new Set();
  let pendingResponded: Set<string> = new Set();
  let pendingTools: ChatMessage[] = [];

  const closePendingBlock = (): void => {
    if (pendingAssistant === null) return;
    out.push(pendingAssistant);
    // Emit retained tool messages first (those that paired against
    // a real id in the assistant). Stubs are appended after — the
    // strict-OpenAI contract only requires every tool_call_id to
    // appear once in the response block; order within the block is
    // free.
    for (const t of pendingTools) out.push(t);
    if (Array.isArray(pendingAssistant.tool_calls)) {
      for (const tc of pendingAssistant.tool_calls) {
        if (!pendingResponded.has(tc.id)) {
          out.push({
            role: 'tool',
            tool_call_id: tc.id,
            name: tc.function.name,
            content: ORPHAN_STUB
          });
          injectedStubs += 1;
        }
      }
    }
    pendingAssistant = null;
    pendingValidIds = new Set();
    pendingResponded = new Set();
    pendingTools = [];
  };

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;

    if (m.role === 'assistant') {
      // Boundary — close the previous block (if any) BEFORE starting
      // the new one so retained-then-stubbed ordering matches the
      // legacy behaviour.
      closePendingBlock();
      pendingAssistant = m;
      pendingValidIds = new Set();
      pendingResponded = new Set();
      pendingTools = [];
      if (Array.isArray(m.tool_calls)) {
        for (const tc of m.tool_calls) pendingValidIds.add(tc.id);
      }
      continue;
    }

    if (m.role === 'tool') {
      const id = typeof m.tool_call_id === 'string' ? m.tool_call_id : '';
      if (!pendingValidIds.has(id)) {
        // Orphan: no preceding assistant has a matching
        // `tool_calls[].id`. Drop rather than forward — strict
        // providers reject the message with a generic 400. Logged
        // so transcripts with the issue are debuggable from
        // `vyotiq.log`.
        droppedOrphans += 1;
        log.warn('dropping orphan role:tool message — no matching assistant.tool_calls[].id', {
          tool_call_id: id,
          name: m.name ?? null
        });
        continue;
      }
      pendingResponded.add(id);
      pendingTools.push(m);
      continue;
    }

    // User / system / any future role: close any open response block
    // first so stubs never appear AFTER a user message (strict
    // providers expect the response block to be contiguous).
    closePendingBlock();
    out.push(m);
  }
  // Final flush — handles a transcript that ends with an assistant
  // (tool_calls + responses, possibly missing some).
  closePendingBlock();

  if (droppedOrphans > 0) {
    log.info('orphan tool messages dropped from request', { droppedOrphans });
  }
  return {
    messages: out,
    stats: { injectedStubs, droppedOrphans }
  };
}
