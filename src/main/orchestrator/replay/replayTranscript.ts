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

import type { ChatMessage, TimelineEvent } from '@shared/types/chat.js';
import { MAX_TOOL_OUTPUT_CHARS } from '@shared/constants.js';
import { truncateUtf8Safe } from '@shared/text/truncateUtf8Safe.js';
import { stableStringify } from '@shared/json/stableStringify.js';
import { wrapXml } from '../envelope/index.js';

export function replayTranscript(events: TimelineEvent[]): ChatMessage[] {
  const messages: ChatMessage[] = [];

  let curAssistantId: string | null = null;
  let curText = '';
  let curReasoning = '';
  let curReasoningSignature = '';
  let curToolCalls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> = [];
  const toolCallMeta = new Map<string, { name: string }>();
  let pendingCallIds: string[] = [];

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
        pendingCallIds = [];
        const content =
          wrapXml('turn', wrapXml('user_message', e.content, undefined, { escape: true }));
        messages.push({ role: 'user', content });
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
        const tc: NonNullable<ChatMessage['tool_calls']>[number] = {
          id: e.call.id,
          type: 'function',
          function: { name: e.call.name, arguments: stableStringify(e.call.args ?? {}) }
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
        const output = truncateUtf8Safe(e.result.output, MAX_TOOL_OUTPUT_CHARS);
        messages.push({
          role: 'tool',
          tool_call_id: callId,
          name: meta?.name ?? e.result.name,
          content: output
        });
        break;
      }
      case 'phase':
      case 'agent-thought':
      case 'file-edit':
      case 'error':
      case 'token-usage':
        break;
      case 'ask-user-prompt': {
        flushAssistant({ dropUnpairedToolCalls: true });
        pendingCallIds = [];
        if (e.displayText.length > 0) {
          messages.push({ role: 'assistant', content: e.displayText });
        }
        break;
      }
      default:
        break;
    }
  }
  flushAssistant();
  return messages;
}

