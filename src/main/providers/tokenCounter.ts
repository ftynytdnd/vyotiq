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
 * Exported entry points (main-process only; renderer uses
 * `@shared/text/tokenizeForModel` for live synthetic counts):
 *   - `estimateTokens(...)` — single-prompt + attachment shape.
 *   - `tokenizeText(modelId, text)` — raw BPE count for any string.
 *   - `tokenizeMessages(modelId, messages, tools)` — full message[]
 *     + tool-schema breakdown.
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
import type { ChatMessage, PromptAttachmentMeta } from '@shared/types/chat.js';
import {
  sumContextBreakdown,
  type ContextUsageBreakdown
} from '@shared/context/contextLevel.js';
import { chatContentToText, isChatContentPartArray } from '@shared/text/chatContent.js';
import { estimateVisionTokensFromContent } from '@shared/text/estimateVisionTokens.js';
import { logger } from '../logging/logger.js';
import { escapeXmlAttr } from '../orchestrator/envelope/index.js';
import {
  CACHE_LAYER_FEW_SHOT_INDEX,
  CACHE_LAYER_HISTORY_START,
  CACHE_LAYER_WORKSPACE_INDEX,
  isCacheLayeredTopology
} from '../orchestrator/context/buildContextLayers.js';
import { realpathInsideWorkspace } from '../tools/sandbox.js';
import { resolveAttachmentsForInline } from '../attachments/resolveAttachmentsForInline.js';
import { prepareVisionParts } from '../attachments/prepareMediaForVision.js';
import { resolveInputModalitiesForSelection } from '../orchestrator/buildUserTurnMessage.js';
import { mediaKindFromMeta } from '@shared/attachments/mediaKind.js';
import type { ModelSelection } from '@shared/types/provider.js';

const log = logger.child('providers/tokenCounter');

/** Per-attachment byte cap, matching `contextManager.inlineFiles`. */
const ATTACHMENT_CHAR_CAP = 32_000;

export interface EstimateInput {
  modelId: string;
  prompt: string;
  attachments?: string[];
  attachmentMeta?: PromptAttachmentMeta[];
  /** Absolute workspace root; used to resolve attachment paths. */
  workspacePath?: string;
  /** When set, vision token estimate uses model modalities. */
  selection?: ModelSelection;
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
      abs = await realpathInsideWorkspace(workspacePath, rel);
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
  if (workspacePath) {
    if (input.attachmentMeta && input.attachmentMeta.length > 0) {
      inlined = await resolveAttachmentsForInline({
        attachmentMeta: input.attachmentMeta,
        workspacePath
      });
    } else if (attachments.length > 0) {
      inlined = await readInlinedAttachments(workspacePath, attachments);
    }
  }
  const combined = inlined ? `${prompt}\n\n${inlined}` : prompt;

  let visionTokens = 0;
  if (
    workspacePath &&
    input.attachmentMeta &&
    input.attachmentMeta.length > 0 &&
    input.selection
  ) {
    const hasVisionable = input.attachmentMeta.some((m) => {
      const kind = m.mediaKind ?? mediaKindFromMeta(m);
      return kind === 'image' || kind === 'pdf' || kind === 'video';
    });
    if (hasVisionable) {
      try {
        const modalities = await resolveInputModalitiesForSelection(input.selection);
        const prepared = await prepareVisionParts({
          attachmentMeta: input.attachmentMeta,
          workspacePath,
          inputModalities: modalities
        });
        visionTokens = prepared.visionTokenEstimate;
      } catch (err) {
        log.debug('vision token estimate failed', { err });
      }
    }
  }

  const enc = resolveEncoding(modelId);
  if (enc !== null) {
    try {
      const tokens = encodeChatBytes(enc, [{ role: 'user', content: combined }]) + visionTokens;
      return { tokens, exact: visionTokens === 0 };
    } catch (err) {
      log.debug('encodeChat failed, falling back to encode', { modelId, err });
      try {
        const tokens = encodeText(enc, combined) + visionTokens;
        return { tokens, exact: visionTokens === 0 };
      } catch (err2) {
        log.debug('encode also failed, falling back to heuristic', { modelId, err: err2 });
      }
    }
  }

  // Heuristic: 3.8 chars ≈ 1 token for English prose.
  const tokens = Math.ceil(combined.length / 3.8) + visionTokens;
  return { tokens, exact: false };
}

// ────────────────────────────────────────────────────────────────────
// Phase 1 — synchronous helpers (`tokenizeText`, `tokenizeMessages`).
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
 *  bundle (tests and other lightweight callers). */
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
   * Per-layer breakdown aligned with the cache-layered prompt topology.
   * See `ContextUsageBreakdown` in `@shared/context/contextLevel`.
   */
  breakdown: ContextUsageBreakdown;
  /** Native vision media tokens across all user messages (when non-zero). */
  visionTokens: number;
}

/**
 * Tokenize the full prospective `messages[] + tools[]` payload. Returns
 * the total token count plus the per-part breakdown the composer
 * token pill surfaces.
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
  const toolJson =
    tools.length > 0 ? tools.map((t) => JSON.stringify(t)).join('\n') : '';
  const toolsTokens = tokenizeText(modelId, toolJson);
  let exact = toolsTokens.exact;

  if (isCacheLayeredTopology(messages)) {
    const runtimeIdx = messages.length - 2;
    const turnIdx = messages.length - 1;

    const systemBody = stringifyMessageBody(messages[0] ?? { role: 'system', content: '' });
    const fewShotBody =
      typeof messages[CACHE_LAYER_FEW_SHOT_INDEX]?.content === 'string'
        ? messages[CACHE_LAYER_FEW_SHOT_INDEX].content
        : '';
    const workspaceBody =
      typeof messages[CACHE_LAYER_WORKSPACE_INDEX]?.content === 'string'
        ? messages[CACHE_LAYER_WORKSPACE_INDEX].content
        : '';
    const runtimeBody = stringifyMessageBody(messages[runtimeIdx] ?? { role: 'user', content: '' });
    const turnBody = stringifyMessageBody(messages[turnIdx] ?? { role: 'user', content: '' });

    const systemTokens = countChatBlock(enc, [{ role: 'system', content: systemBody }]);
    if (!systemTokens.exact) exact = false;
    const fewShotTokens = countChatBlock(enc, [{ role: 'user', content: fewShotBody }]);
    if (!fewShotTokens.exact) exact = false;
    const workspaceTokens = countChatBlock(enc, [{ role: 'user', content: workspaceBody }]);
    if (!workspaceTokens.exact) exact = false;
    const runtimeTokens = countChatBlock(enc, [{ role: 'user', content: runtimeBody }]);
    if (!runtimeTokens.exact) exact = false;
    const turnTokens = countChatBlock(enc, [{ role: 'user', content: turnBody }]);
    if (!turnTokens.exact) exact = false;

    const historyChunks: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (const m of messages.slice(CACHE_LAYER_HISTORY_START, runtimeIdx)) {
      const body = stringifyMessageBody(m);
      if (body.length === 0) continue;
      const collapsedRole: 'user' | 'assistant' =
        m.role === 'assistant' ? 'assistant' : 'user';
      historyChunks.push({ role: collapsedRole, content: body });
    }
    const historyTokens = countChatBlock(enc, historyChunks);
    if (!historyTokens.exact) exact = false;

    const breakdown: ContextUsageBreakdown = {
      system: systemTokens.tokens,
      fewShot: fewShotTokens.tokens,
      workspace: workspaceTokens.tokens,
      history: historyTokens.tokens,
      runtime: runtimeTokens.tokens,
      turn: turnTokens.tokens,
      tools: toolsTokens.tokens
    };
    const visionTokens = collectVisionTokensFromMessages(messages);
    if (visionTokens > 0) exact = false;
    return {
      total: sumContextBreakdown(breakdown) + visionTokens,
      exact,
      breakdown,
      visionTokens
    };
  }

  // Legacy / non-layered topology — fold into system + history buckets.
  const systemChunks: string[] = [];
  const historyChunks: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const m of messages) {
    const body = stringifyMessageBody(m);
    if (m.role === 'system') {
      if (body.length > 0) systemChunks.push(body);
    } else {
      const collapsedRole: 'user' | 'assistant' =
        m.role === 'assistant' ? 'assistant' : 'user';
      if (body.length > 0) historyChunks.push({ role: collapsedRole, content: body });
    }
  }

  const systemTokens = countChatBlock(enc, [
    ...systemChunks.map((c) => ({ role: 'system' as const, content: c }))
  ]);
  if (!systemTokens.exact) exact = false;

  const historyTokens = countChatBlock(enc, historyChunks);
  if (!historyTokens.exact) exact = false;

  const breakdown: ContextUsageBreakdown = {
    system: systemTokens.tokens,
    fewShot: 0,
    workspace: 0,
    history: historyTokens.tokens,
    runtime: 0,
    turn: 0,
    tools: toolsTokens.tokens
  };
  const visionTokens = collectVisionTokensFromMessages(messages);
  if (visionTokens > 0) exact = false;
  return {
    total: sumContextBreakdown(breakdown) + visionTokens,
    exact,
    breakdown,
    visionTokens
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
  } else if (isChatContentPartArray(m.content)) {
    const text = chatContentToText(m.content);
    if (text.length > 0) parts.push(text);
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

function collectVisionTokensFromMessages(messages: ReadonlyArray<TokenizableMessage>): number {
  let total = 0;
  for (const m of messages) {
    if (isChatContentPartArray(m.content)) {
      total += estimateVisionTokensFromContent(m.content);
    }
  }
  return total;
}

/** Char-heuristic shared between `estimateTokens` and `tokenizeText`. */
function heuristicTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / 3.8);
}
