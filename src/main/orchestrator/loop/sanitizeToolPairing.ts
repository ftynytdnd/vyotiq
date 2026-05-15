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
  // Pass 1: gather the set of `tool_call_id`s that belong to any
  // preceding assistant within each response block. An orphan
  // `role:'tool'` message is one whose id is NOT a member of the
  // CURRENT response block's valid-id set. We rebuild the set every
  // time an `assistant` appears because each assistant starts a fresh
  // response block.
  const out: ChatMessage[] = [];
  let currentValidIds: Set<string> = new Set();
  let droppedOrphans = 0;

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;

    if (m.role === 'assistant') {
      // New response block opens here. Recompute the valid-id set from
      // this assistant's `tool_calls` (may be empty).
      currentValidIds = new Set();
      if (Array.isArray(m.tool_calls)) {
        for (const tc of m.tool_calls) currentValidIds.add(tc.id);
      }
      out.push(m);

      if (!Array.isArray(m.tool_calls) || m.tool_calls.length === 0) {
        continue;
      }
      // Locate the response block — everything between this assistant
      // message and the next assistant message (exclusive).
      let endIdx = messages.length;
      for (let j = i + 1; j < messages.length; j++) {
        if (messages[j]!.role === 'assistant') {
          endIdx = j;
          break;
        }
      }
      const responded = new Set<string>();
      for (let k = i + 1; k < endIdx; k++) {
        const t = messages[k]!;
        if (t.role === 'tool' && typeof t.tool_call_id === 'string') {
          // Only count tool messages whose id is in the valid set —
          // the orphan-drop pass below will strip the invalid ones, so
          // they shouldn't satisfy the pairing requirement here either.
          if (currentValidIds.has(t.tool_call_id)) {
            responded.add(t.tool_call_id);
          }
        }
      }
      for (const tc of m.tool_calls) {
        if (!responded.has(tc.id)) {
          out.push({
            role: 'tool',
            tool_call_id: tc.id,
            name: tc.function.name,
            content: ORPHAN_STUB
          });
        }
      }
      continue;
    }

    if (m.role === 'tool') {
      // Orphan detection: a tool message whose id is NOT a member of
      // the most recent assistant's `tool_calls` set is illegal under
      // strict providers. Drop it rather than forwarding a guaranteed
      // 400. Logged so transcripts with the issue are debuggable from
      // `vyotiq.log`.
      const id = typeof m.tool_call_id === 'string' ? m.tool_call_id : '';
      if (!currentValidIds.has(id)) {
        droppedOrphans += 1;
        log.warn('dropping orphan role:tool message — no matching assistant.tool_calls[].id', {
          tool_call_id: id,
          name: m.name ?? null
        });
        continue;
      }
      out.push(m);
      continue;
    }

    // User / system / any future role passes through unchanged.
    out.push(m);
  }

  if (droppedOrphans > 0) {
    log.info('orphan tool messages dropped from request', { droppedOrphans });
  }
  return out;
}
