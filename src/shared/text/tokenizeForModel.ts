/**
 * Renderer-safe token estimator. Mirrors the main-process
 * `tokenizeText(modelId, text)` API but uses ONLY `gpt-tokenizer`
 * sub-paths that are safe to bundle into the renderer build (no
 * node:fs, no main-only deps).
 *
 * Used by:
 *   - `chatChannel.ts` (Phase 3) — to grow `inFlight.completionTokens`
 *     in real time as the assistant streams text + reasoning bytes.
 *   - `useStreamingTokRate` (Phase 12) — model-aware tok/s instead
 *     of the chars/4 fudge `LiveStatusRow` currently uses.
 *
 * Encoding selection mirrors `tokenCounter.resolveEncoding` so a
 * pre-flight estimate and a mid-stream estimate over the same model
 * use the same BPE. The chars/3.8 fallback path is identical too.
 *
 * `gpt-tokenizer` is already pulled into the renderer bundle via
 * `applyTimelineEvent`'s safeParsePartial dependency chain — no new
 * dependency or bundle-size cost.
 */

import { encode as encodeO200k } from 'gpt-tokenizer/model/gpt-4o';
import { encode as encodeCl100k } from 'gpt-tokenizer/model/gpt-4';

type Encoding = 'o200k' | 'cl100k';

/**
 * Same regex-free rules as `tokenCounter.resolveEncoding`. Returns
 * `null` for models without a public BPE we can match (Anthropic,
 * Gemini, Qwen, Llama, Mistral, Command, …) — callers must fall
 * back to a char heuristic.
 *
 * The two implementations must stay in lockstep so a pre-flight
 * estimate and a mid-stream estimate agree to the byte. The plan's
 * `2026-verified traps` section flags this as a hard contract.
 */
function resolveEncoding(modelId: string): Encoding | null {
  const id = modelId.toLowerCase();
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
  if (id.includes('gpt-4') || id.includes('gpt-3.5') || id.includes('turbo')) {
    return 'cl100k';
  }
  return null;
}

/**
 * Renderer-safe token estimate. Returns the integer token count for
 * `text` against `modelId`'s encoding. Never throws — any internal
 * error falls through to the chars/3.8 heuristic.
 *
 * `exact` is omitted here (vs the main-side shape) because the only
 * caller — the synthetic mid-stream counter — doesn't surface the
 * exactness flag anywhere. The renderer pill's exactness comes from
 * the IPC pre-flight estimate; mid-stream is by definition synthetic.
 */
export function tokenizeForModel(modelId: string, text: string): number {
  if (text.length === 0) return 0;
  const enc = resolveEncoding(modelId);
  if (enc !== null) {
    try {
      return enc === 'o200k' ? encodeO200k(text).length : encodeCl100k(text).length;
    } catch {
      /* fall through to heuristic */
    }
  }
  return Math.ceil(text.length / 3.8);
}
