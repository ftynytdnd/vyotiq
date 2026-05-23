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
 *   - xAI Grok 4.x → o200k_base (same family at the BPE level).
 *   - Anything we can't place (Claude, Gemini, Qwen, etc.) →
 *     chars/3.8 heuristic, and the `exact: false` flag is returned so
 *     the UI can render the value in italics.
 *
 * Three exported entry points:
 *   - `estimateTokens(...)`  — legacy single-prompt + attachment shape used
 *     by the composer's keystroke-debounced pre-flight estimate.
 *   - `tokenizeText(modelId, text)` — raw BPE count for any string.
 *     The renderer-safe equivalent (`@shared/text/tokenizeForModel`)
 *     mirrors this signature for the synthetic mid-stream counter.
 *   - `tokenizeMessages(modelId, messages, tools)` — Phase 2's full
 *     prospective-payload tokenizer. Sums every message body + the
 *     serialized tool catalogue and returns the per-part breakdown the
 *     Inspector's wire-breakdown section consumes.
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
  // o200k family — GPT-4o, o1, o3, o4, GPT-5, DeepSeek v3/v4, xAI Grok 4.x.
  // Grok's tokenizer is closely related to OpenAI's; the public docs
  // and the wire usage frames line up to within a few percent against
  // the o200k BPE, so we route it here rather than to the chars/3.8
  // heuristic (which would render the pill as italic / pre-Phase-5
  // would have under-counted by ~10%).
  if (
    id.includes('gpt-4o') ||
    id.includes('gpt-4.1') ||
    id.includes('gpt-5') ||
    id.startsWith('o1') ||
    id.startsWith('o3') ||
    id.startsWith('o4') ||
    id.includes('deepseek') ||
    id.includes('grok') ||
    id.startsWith('xai')
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

  // Heuristic: 3.8 chars ≈ 1 token for English prose.
  const tokens = Math.ceil(combined.length / 3.8);
  return { tokens, exact: false };
}

// ────────────────────────────────────────────────────────────────────
// Phase 1 — additional exports for full-baseline + synthetic counter.
// `estimateTokens` above is unchanged so the legacy IPC keeps working.
// ────────────────────────────────────────────────────────────────────

/**
 * Raw BPE / heuristic count for a single string. Synchronous —
 * `estimateTokens` is the path that needs IO (attachments); this one
 * is pure and cheap.
 *
 * `exact: false` is returned when we fell back to the chars/3.8
 * heuristic (Claude, Gemini, Qwen, unknown models). Mirrors the same
 * flag on `EstimateResult` so the UI can render the value as an
 * estimate.
 */
export function tokenizeText(modelId: string, text: string): EstimateResult {
  if (text.length === 0) return { tokens: 0, exact: true };
  const enc = resolveEncoding(modelId);
  if (enc !== null) {
    try {
      return { tokens: encodeText(enc, text), exact: true };
    } catch (err) {
      log.debug('tokenizeText encode failed, falling back to heuristic', {
        modelId,
        err
      });
    }
  }
  return { tokens: heuristicTokens(text), exact: false };
}

/** Per-message tokenized message shape used by `tokenizeMessages`. */
type TokenizableMessage = Pick<ChatMessage, 'role' | 'content' | 'tool_calls' | 'reasoning_content'>;

/** Tool-schema shape mirroring `ChatStreamRequest.tools[]`. Inlined here
 *  rather than imported from `chatClient.ts` so this module stays
 *  reachable from places that don't already pull in the chat client
 *  bundle (the IPC layer, the inspector snapshot builder, tests). */
export interface TokenizableToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface MessagesEstimateResult {
  /** Sum of every part below. The number the request body would tokenize to. */
  total: number;
  /** True when every part used a real BPE tokenizer (no heuristic fallback). */
  exact: boolean;
  /**
   * Per-part breakdown. Surfaced so the Inspector's wire-breakdown
   * footer and the composer pill's hover tooltip can render the same
   * authoritative numbers without re-tokenizing.
   *
   *   - `systemPrompt`: every `role:'system'` message's content concatenated
   *     and tokenized as a chat block.
   *   - `history`: all non-system messages (user / assistant / tool) plus
   *     their `tool_calls` arguments JSON and `reasoning_content` echoes.
   *   - `tools`: the serialized tool catalogue (compact JSON, no whitespace
   *     — closely approximates the wire form OpenAI-compat providers ship).
   */
  byPart: {
    systemPrompt: number;
    history: number;
    tools: number;
  };
}

/**
 * Tokenize the full prospective `messages[] + tools[]` payload. Returns
 * the total token count plus the per-part breakdown the Inspector
 * surfaces.
 *
 * Wire fidelity notes:
 *   - Tool schemas are tokenized as `JSON.stringify(tool)` (compact).
 *     Provider-side serialization adds ~1-2% of framing overhead which
 *     we accept; the alternative — guessing per-dialect wire wrappers —
 *     is far more brittle.
 *   - Per-message framing tokens (role separators, etc.) are captured
 *     via `encodeChat` for the OpenAI families. For heuristic fallback
 *     models we still concatenate; the chars/3.8 approximation absorbs
 *     framing implicitly.
 *   - `reasoning_content` echoes are tokenized when present (some
 *     dialects round-trip them and they count against the budget).
 *
 * Synchronous (no IO). Callers that need attachment inlining go through
 * `contextManager` first to build the prospective `messages[]` and pass
 * the result here.
 */
export function tokenizeMessages(
  modelId: string,
  messages: ReadonlyArray<TokenizableMessage>,
  tools: ReadonlyArray<TokenizableToolSchema> = []
): MessagesEstimateResult {
  const enc = resolveEncoding(modelId);

  // ── Split into system vs non-system slices ──
  const systemChunks: string[] = [];
  const historyChunks: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const m of messages) {
    const body = stringifyMessageBody(m);
    if (m.role === 'system') {
      if (body.length > 0) systemChunks.push(body);
    } else {
      // Collapse tool messages and assistant tool_calls into the
      // history token bucket. Role normalized to 'user' / 'assistant'
      // for `encodeChat` compatibility — the BPE bytes inside the body
      // already encode tool_call / tool_result framing.
      const collapsedRole: 'user' | 'assistant' =
        m.role === 'assistant' ? 'assistant' : 'user';
      if (body.length > 0) historyChunks.push({ role: collapsedRole, content: body });
    }
  }

  const toolJson =
    tools.length > 0 ? tools.map((t) => JSON.stringify(t)).join('\n') : '';

  // ── Tokenize each part ──
  let exact = true;
  const systemTokens = countChatBlock(enc, [
    ...systemChunks.map((c) => ({ role: 'system' as const, content: c }))
  ]);
  if (!systemTokens.exact) exact = false;

  const historyTokens = countChatBlock(enc, historyChunks);
  if (!historyTokens.exact) exact = false;

  const toolsTokens = tokenizeText(modelId, toolJson);
  if (!toolsTokens.exact) exact = false;

  return {
    total: systemTokens.tokens + historyTokens.tokens + toolsTokens.tokens,
    exact,
    byPart: {
      systemPrompt: systemTokens.tokens,
      history: historyTokens.tokens,
      tools: toolsTokens.tokens
    }
  };
}

/**
 * Tokenize a list of role-tagged message chunks. Uses `encodeChat` for
 * BPE-supported encodings (captures the per-message framing overhead
 * the real request will incur); falls back to chars/3.8 over the
 * concatenated body for heuristic models. Empty array → zero tokens.
 */
function countChatBlock(
  enc: Encoding | null,
  msgs: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
): EstimateResult {
  if (msgs.length === 0) return { tokens: 0, exact: true };
  if (enc !== null) {
    try {
      return { tokens: encodeChatBytes(enc, msgs), exact: true };
    } catch (err) {
      log.debug('countChatBlock encodeChat failed, falling back to per-message encode', {
        err
      });
      try {
        // Sum per-message encodes — loses the framing tokens but is
        // exact-otherwise. Better than dropping straight to chars/3.8
        // for an OpenAI-family model.
        let total = 0;
        for (const m of msgs) total += encodeText(enc, m.content);
        return { tokens: total, exact: true };
      } catch {
        /* fall through to heuristic */
      }
    }
  }
  const concat = msgs.map((m) => m.content).join('\n');
  return { tokens: heuristicTokens(concat), exact: false };
}

/**
 * Flatten a `ChatMessage` into the string that will hit the wire for
 * tokenization purposes. Includes:
 *   - `content` (or '' when null)
 *   - any `tool_calls[].function.arguments` (already a JSON string)
 *   - the `reasoning_content` echo when present (some dialects
 *     round-trip it and it costs prompt tokens)
 */
function stringifyMessageBody(m: TokenizableMessage): string {
  const parts: string[] = [];
  if (typeof m.content === 'string' && m.content.length > 0) {
    parts.push(m.content);
  }
  if (Array.isArray(m.tool_calls)) {
    for (const tc of m.tool_calls) {
      parts.push(tc.function.name);
      parts.push(tc.function.arguments);
    }
  }
  if (typeof m.reasoning_content === 'string' && m.reasoning_content.length > 0) {
    parts.push(m.reasoning_content);
  }
  return parts.join('\n');
}

/** Char-heuristic shared between `estimateTokens` and `tokenizeText`. */
function heuristicTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / 3.8);
}
