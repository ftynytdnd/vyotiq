/**
 * Pre-flight token counter. Runs in the MAIN process so the 200KB
 * `gpt-tokenizer` bundle stays out of the renderer and so we can share
 * `inlineFiles`'s exact same attachment-inlining contract the
 * orchestrator uses (same 32KB/file cap, same `<file path="…">…</file>`
 * wrapping). The number we report is what the real request would send,
 * modulo tokenizer accuracy.
 *
 * Encoding selection:
 *   - Models whose id looks like a GPT-4o / o200k family → o200k_base.
 *   - Older `gpt-3.5` / `gpt-4-*` families → cl100k_base.
 *   - DeepSeek v3 / v4 → o200k_base (their public tokenizer is a close
 *     enough approximation; actual counts are within a few %).
 *   - Anything we can't place (Claude, Gemini, Qwen, etc.) →
 *     chars/3.8 heuristic, and the `exact: false` flag is returned so
 *     the UI can render the value in italics.
 */

import { promises as fs } from 'node:fs';
import {
  encode as encodeO200k,
  encodeChat as encodeChatO200k
} from 'gpt-tokenizer/model/gpt-4o';
import {
  encode as encodeCl100k,
  encodeChat as encodeChatCl100k
} from 'gpt-tokenizer/model/gpt-4';
import type { ChatMessage } from '@shared/types/chat.js';
import { logger } from '../logging/logger.js';
import { escapeXmlAttr } from '../orchestrator/envelope/index.js';
import { resolveInsideWorkspace } from '../tools/sandbox.js';

const log = logger.child('providers/tokenCounter');

/** Per-attachment byte cap, matching `contextManager.inlineFiles`. */
const ATTACHMENT_CHAR_CAP = 32_000;

export interface EstimateInput {
  modelId: string;
  prompt: string;
  attachments?: string[];
  /** Absolute workspace root; used to resolve attachment paths. */
  workspacePath?: string;
}

export interface EstimateResult {
  tokens: number;
  /**
   * True when we used a real BPE tokenizer matched to the model's
   * encoding; false when we fell back to the chars/3.8 heuristic
   * (Claude, Gemini, unknown providers). The composer renders this as
   * an italic slash to hint "this is an estimate".
   */
  exact: boolean;
}

type Encoding = 'o200k' | 'cl100k';

function resolveEncoding(modelId: string): Encoding | null {
  const id = modelId.toLowerCase();
  // o200k family — GPT-4o, o1, o3, o4, GPT-5, DeepSeek v3/v4.
  if (
    id.includes('gpt-4o') ||
    id.includes('gpt-4.1') ||
    id.includes('gpt-5') ||
    id.startsWith('o1') ||
    id.startsWith('o3') ||
    id.startsWith('o4') ||
    id.includes('deepseek')
  ) {
    return 'o200k';
  }
  // cl100k family — older GPT-4 / GPT-3.5-turbo.
  if (id.includes('gpt-4') || id.includes('gpt-3.5') || id.includes('turbo')) {
    return 'cl100k';
  }
  // Anthropic, Gemini, Qwen, Mistral, Llama, Command, etc.: no public
  // open-source BPE matches exactly. Return null → caller falls back to
  // the char-based heuristic.
  return null;
}

function encodeText(encoding: Encoding, text: string): number {
  if (encoding === 'o200k') return encodeO200k(text).length;
  return encodeCl100k(text).length;
}

function encodeChatBytes(
  encoding: Encoding,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
): number {
  // `encodeChat` accepts only the legacy role names the wrapper supports.
  // We cast the known-safe subset here rather than leaking the library's
  // narrower type everywhere.
  type ChatMsg = { role: 'system' | 'user' | 'assistant'; content: string };
  if (encoding === 'o200k') return encodeChatO200k(messages as ChatMsg[], 'gpt-4o').length;
  return encodeChatCl100k(messages as ChatMsg[], 'gpt-4').length;
}

async function readInlinedAttachments(
  workspacePath: string,
  attachments: string[]
): Promise<string> {
  if (attachments.length === 0) return '';
  const parts: string[] = [];
  for (const rel of attachments) {
    // Match `contextManager.inlineFiles`'s attribute escaping so the
    // pre-flight token count reflects the exact bytes the orchestrator
    // will send. A path containing `"` would otherwise tokenize
    // differently here than on the real request.
    const safeRel = escapeXmlAttr(rel);
    // Privacy boundary — route through the workspace sandbox BEFORE any
    // filesystem read so a renderer-supplied escape (e.g. `"../../.ssh/
    // id_rsa"`) cannot reveal existence / approximate size of arbitrary
    // files through the returned token count. Mirrors the identical
    // guard in `contextManager.inlineFiles`.
    let abs: string;
    try {
      abs = resolveInsideWorkspace(workspacePath, rel);
    } catch {
      parts.push(`<file path="${safeRel}" error="unreadable" />`);
      continue;
    }
    try {
      const txt = await fs.readFile(abs, 'utf8');
      parts.push(`<file path="${safeRel}">\n${txt.slice(0, ATTACHMENT_CHAR_CAP)}\n</file>`);
    } catch {
      // Mirror inlineFiles' behavior: emit an error marker so the count
      // matches what the orchestrator will actually send. We intentionally
      // do NOT surface the error; pre-flight is best-effort UI only.
      parts.push(`<file path="${safeRel}" error="unreadable" />`);
    }
  }
  return parts.join('\n\n');
}

/**
 * Best-effort pre-flight token count. Never throws — any internal error
 * is logged at debug level and falls through to the heuristic.
 */
export async function estimateTokens(input: EstimateInput): Promise<EstimateResult> {
  const { modelId, prompt } = input;
  const attachments = input.attachments ?? [];
  const workspacePath = input.workspacePath ?? '';

  let inlined = '';
  if (workspacePath && attachments.length > 0) {
    inlined = await readInlinedAttachments(workspacePath, attachments);
  }
  const combined = inlined ? `${prompt}\n\n${inlined}` : prompt;

  const enc = resolveEncoding(modelId);
  if (enc !== null) {
    try {
      // `encodeChat` also captures the per-message framing overhead
      // (role + separator tokens) that the real request will incur, so
      // we use it when we have a plausible role shape. Fall back to raw
      // `encode` if the chat encoder throws for any reason.
      const tokens = encodeChatBytes(enc, [{ role: 'user', content: combined }]);
      return { tokens, exact: true };
    } catch (err) {
      log.debug('encodeChat failed, falling back to encode', { modelId, err });
      try {
        const tokens = encodeText(enc, combined);
        return { tokens, exact: true };
      } catch (err2) {
        log.debug('encode also failed, falling back to heuristic', { modelId, err: err2 });
      }
    }
  }

  // Heuristic: 3.8 chars ≈ 1 token for English prose. This matches the
  // codebase's existing CONTEXT_PRUNE calibration within a few percent.
  const tokens = Math.ceil(combined.length / 3.8);
  return { tokens, exact: false };
}

/**
 * Per-message framing overhead used by the heuristic fallback path.
 * `encodeChat` already accounts for role + separator tokens when the
 * BPE encoder matches the model; this constant covers the same bytes
 * for providers we can't tokenize exactly (Claude, Gemini, Qwen, …).
 * Tuned to OpenAI's documented `tokens_per_message ≈ 3` plus one
 * separator — a small over-estimate is safer than under-estimating
 * since `enforceContextBudget` uses the count to decide when to trim.
 */
const HEURISTIC_PER_MESSAGE_OVERHEAD = 4;

/**
 * Pre-flight token count for an entire `ChatMessage[]`. Used by the
 * orchestrator's per-turn token-budget enforcement (Audit fix §2.3) to
 * decide when to trim the rolling history before issuing a request.
 *
 * Strategy:
 *   - When the model's encoding is known, run `encodeChat` over a
 *     normalized projection of the messages. Tool-call envelopes,
 *     reasoning text, and tool results all contribute via stable
 *     string projections so the count tracks what the wire format
 *     will actually carry. Mirrors the wrapping `chatClient` performs.
 *   - Otherwise fall back to `chars / 3.8` plus the per-message
 *     overhead so the trim policy still has a usable budget for
 *     Claude/Gemini-style providers.
 *
 * Pure / never throws — any encoder failure falls through to the
 * heuristic. Reasoning text is intentionally INCLUDED: providers that
 * accept `reasoning_content` (DeepSeek-style) DO send it on the wire
 * and the budget must reflect that.
 */
export function estimateMessagesTokens(
  messages: ReadonlyArray<ChatMessage>,
  modelId: string
): number {
  if (messages.length === 0) return 0;

  // Build a normalized text projection per message. Tool-call shapes
  // and tool-result shapes are stringified through the same JSON the
  // wire carries so the count stays close to the real upload.
  const projected = messages.map((m) => projectMessage(m));

  const enc = resolveEncoding(modelId);
  if (enc !== null) {
    try {
      // `encodeChat` only models the legacy `system` / `user` /
      // `assistant` roles — `tool` and the assistant-with-tool-calls
      // shape carry no public framing constants. Roll our own:
      //   - encode each message body as raw text
      //   - add the per-message overhead constant once
      // This is what OpenAI's own cookbook recommends for non-trivial
      // shapes (see "How to count tokens with tiktoken").
      let total = 0;
      for (const text of projected) {
        total += encodeText(enc, text);
        total += HEURISTIC_PER_MESSAGE_OVERHEAD;
      }
      // Trailing primer the chat completion API always reserves.
      total += 3;
      return total;
    } catch (err) {
      log.debug('estimateMessagesTokens encode failed, falling back', { modelId, err });
    }
  }

  let total = 0;
  for (const text of projected) {
    total += Math.ceil(text.length / 3.8) + HEURISTIC_PER_MESSAGE_OVERHEAD;
  }
  return total + 3;
}

/**
 * Stable string projection of a single `ChatMessage` for token
 * estimation. Picks up text content, reasoning, tool-call envelopes,
 * and tool-result bodies — the same fields the wire transport sends.
 *
 * Pure / no-throw. Unknown shapes degrade to JSON.stringify so any
 * future role addition still contributes a sensible byte count
 * without forcing an estimator update.
 */
function projectMessage(m: ChatMessage): string {
  const parts: string[] = [];
  parts.push(m.role);
  if (typeof m.content === 'string') {
    parts.push(m.content);
  } else if (m.content === null) {
    // Assistant turn with `tool_calls` only — body lives below.
  } else {
    try {
      parts.push(JSON.stringify(m.content));
    } catch {
      parts.push(String(m.content));
    }
  }
  // Reasoning content (DeepSeek-style separate stream).
  if ('reasoning_content' in m && typeof m.reasoning_content === 'string') {
    parts.push(m.reasoning_content);
  }
  // Assistant tool-call envelopes — the wire form is the JSON shape.
  if ('tool_calls' in m && Array.isArray(m.tool_calls)) {
    try {
      parts.push(JSON.stringify(m.tool_calls));
    } catch {
      // Fall through; an unstringifiable cycle is not realistic for
      // our shapes but the fallback keeps the estimator total non-zero.
    }
  }
  if ('name' in m && typeof m.name === 'string') parts.push(m.name);
  if ('tool_call_id' in m && typeof m.tool_call_id === 'string') {
    parts.push(m.tool_call_id);
  }
  return parts.join('\n');
}
