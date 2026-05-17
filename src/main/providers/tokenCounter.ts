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

  // Heuristic: 3.8 chars ≈ 1 token for English prose.
  const tokens = Math.ceil(combined.length / 3.8);
  return { tokens, exact: false };
}
