/**
 * Reconstructs the OpenAI-canonical `messages` array from a persisted
 * TimelineEvent stream. This is what restores the agent's memory
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
 *   - `phase`, `agent-thought`, `error` → skipped (UI-only, not model
 *      memory).
 */

import { serializeAskUserToolArguments } from '@shared/text/parseAskUser.js';
import type { ChatMessage, TimelineEvent } from '@shared/types/chat.js';
import { truncateToolOutputForContext } from '@shared/text/truncateUtf8Safe.js';
import { stableStringify } from '@shared/json/stableStringify.js';
import { wrapXml } from '../envelope/index.js';
import { buildCompactionBanner, buildToolInputBanner } from '../context/compactionArtifacts.js';
import { buildContextSummaryMessage } from '../context/contextSummarize.js';

export function replayTranscript(events: TimelineEvent[]): ChatMessage[] {
  const messages: ChatMessage[] = [];

  // Pre-pass: collect reversible-compaction markers. A `tool-compacted`
  // event is persisted in a LATER iteration than the original
  // `tool-result` it offloads, so we must resolve the map up front and
  // then emit the lean banner (not the full output) when the matching
  // tool row is rebuilt below. This keeps replayed cross-turn memory at
  // the same lean ceiling the live run reached; the model re-reads the
  // artifact on demand. See `docs/context-compaction-design.md`.
  const compactedByCallId = new Map<string, string>();
  // Separately track tool-CALL *input* offloads (reason 'input'): these shrink
  // the assistant tool_call arguments, not the tool result. Keyed apart so an
  // input-only offload never makes the result row render a banner.
  const inputCompactedByCallId = new Map<string, string>();
  for (const e of events) {
    if (e.kind === 'tool-compacted') {
      if (e.reason === 'input') inputCompactedByCallId.set(e.toolCallId, e.relativePath);
      else compactedByCallId.set(e.toolCallId, e.relativePath);
    }
  }

  let curAssistantId: string | null = null;
  let curText = '';
  let curReasoning = '';
  let curReasoningSignature = '';
  let curToolCalls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> = [];
  const toolCallMeta = new Map<string, { name: string }>();
  let pendingCallIds: string[] = [];
  /** User answer deferred until pending `ask_user` tool-result is replayed. */
  let deferredUserAfterTools: ChatMessage | null = null;

  function pushUserPrompt(content: string): void {
    const wrapped = wrapXml('turn', wrapXml('user_message', content, undefined, { escape: true }));
    const msg: ChatMessage = { role: 'user', content: wrapped };
    if (pendingCallIds.length > 0) {
      deferredUserAfterTools = msg;
      return;
    }
    messages.push(msg);
  }

  function flushDeferredUserAfterTools(): void {
    if (!deferredUserAfterTools) return;
    messages.push(deferredUserAfterTools);
    deferredUserAfterTools = null;
  }

  const flushAssistant = (opts?: { dropUnpairedToolCalls?: boolean }) => {
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
    if (curReasoningSignature.length > 0) msg.reasoning_signature = curReasoningSignature;
    if (curToolCalls.length > 0) {
      if (opts?.dropUnpairedToolCalls) {
        const paired = curToolCalls.filter((tc) => !pendingCallIds.includes(tc.id));
        if (paired.length > 0) msg.tool_calls = paired;
      } else {
        msg.tool_calls = curToolCalls;
      }
    }
    messages.push(msg);
    curAssistantId = null;
    curText = '';
    curReasoning = '';
    curReasoningSignature = '';
    curToolCalls = [];
  };

  for (const e of events) {
    switch (e.kind) {
      case 'user-prompt': {
        flushAssistant({ dropUnpairedToolCalls: true });
        pushUserPrompt(e.content);
        break;
      }
      case 'agent-text-delta':
      case 'agent-reasoning-delta': {
        if (curAssistantId !== e.id) {
          flushAssistant();
          curAssistantId = e.id;
        }
        if (e.kind === 'agent-text-delta') curText += e.delta;
        else curReasoning += e.delta;
        break;
      }
      case 'agent-text-aborted': {
        if (curAssistantId === e.id) {
          curAssistantId = null;
          curText = '';
          curReasoning = '';
          curReasoningSignature = '';
          curToolCalls = [];
          pendingCallIds = [];
        }
        break;
      }
      case 'agent-text-end':
        break;
      case 'agent-reasoning-end':
        if (typeof e.signature === 'string' && e.signature.length > 0) {
          curReasoningSignature = e.signature;
        }
        break;
      case 'tool-call': {
        if (
          toolCallMeta.has(e.call.id) &&
          !pendingCallIds.includes(e.call.id)
        ) {
          break;
        }
        if (curAssistantId === null) curAssistantId = `call-anchor-${e.id}`;
        // If this call's arguments were offloaded (reason 'input'), rebuild the
        // lean banner instead of the full arguments — mirrors the live run's
        // reduced context so cross-turn memory stays at the same ceiling.
        const inputCompactedPath = inputCompactedByCallId.get(e.call.id);
        const tc: NonNullable<ChatMessage['tool_calls']>[number] = {
          id: e.call.id,
          type: 'function',
          function: {
            name: e.call.name,
            arguments:
              inputCompactedPath !== undefined
                ? buildToolInputBanner(inputCompactedPath)
                : stableStringify(e.call.args ?? {})
          }
        };
        if (typeof e.call.thoughtSignature === 'string' && e.call.thoughtSignature.length > 0) {
          tc.thoughtSignature = e.call.thoughtSignature;
        }
        curToolCalls.push(tc);
        toolCallMeta.set(e.call.id, { name: e.call.name });
        pendingCallIds.push(e.call.id);
        break;
      }
      case 'tool-result': {
        if (
          toolCallMeta.has(e.result.id) &&
          !pendingCallIds.includes(e.result.id)
        ) {
          break;
        }
        flushAssistant();
        let callId: string;
        const idMatchIdx = pendingCallIds.indexOf(e.result.id);
        if (idMatchIdx !== -1) {
          pendingCallIds.splice(idMatchIdx, 1);
          callId = e.result.id;
        } else {
          callId = pendingCallIds.shift() ?? e.result.id;
        }
        const meta = toolCallMeta.get(callId);
        const compactedPath = compactedByCallId.get(callId);
        const output =
          compactedPath !== undefined
            ? buildCompactionBanner(compactedPath)
            : truncateToolOutputForContext(e.result.output);
        messages.push({
          role: 'tool',
          tool_call_id: callId,
          name: meta?.name ?? e.result.name,
          content: output
        });
        if (pendingCallIds.length === 0) {
          flushDeferredUserAfterTools();
        }
        break;
      }
      case 'phase':
      case 'agent-thought':
      case 'file-edit':
      case 'error':
      case 'token-usage':
      case 'context-usage':
        break;
      case 'tool-compacted':
        // Resolved in the pre-pass above; the matching `tool-result`
        // emits the banner instead of the full output.
        break;
      case 'context-summary': {
        // Reversible summarization collapsed all prior history into one
        // structured block. Discard everything accumulated so far and
        // continue from the lean summary (later turns replay after it).
        flushAssistant({ dropUnpairedToolCalls: true });
        pendingCallIds = [];
        messages.length = 0;
        messages.push({
          role: 'user',
          content: buildContextSummaryMessage(e.summary, e.relativePath)
        });
        break;
      }
      case 'ask-user-prompt': {
        flushAssistant({ dropUnpairedToolCalls: true });
        pendingCallIds = [];
        const askTc: NonNullable<ChatMessage['tool_calls']>[number] = {
          id: e.toolCallId,
          type: 'function',
          function: {
            name: 'ask_user',
            arguments: serializeAskUserToolArguments(e.payload, e.displayText)
          }
        };
        messages.push({
          role: 'assistant',
          content: e.displayText.length > 0 ? e.displayText : null,
          tool_calls: [askTc]
        });
        toolCallMeta.set(e.toolCallId, { name: 'ask_user' });
        pendingCallIds.push(e.toolCallId);
        break;
      }
      default:
        break;
    }
  }
  flushAssistant();
  flushDeferredUserAfterTools();
  return messages;
}

