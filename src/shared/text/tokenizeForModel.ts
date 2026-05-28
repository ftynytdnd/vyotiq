/**
 * Renderer-safe token estimator for mid-stream synthetic usage.
 *
 * Uses the same chars/3.8 heuristic as `tokenCounter` when no public
 * BPE is available. The real `gpt-tokenizer` bundle stays in the main
 * process (`providers/tokenCounter.ts`) so the renderer build does
 * not pay the ~200 KB cost — pre-flight estimates go through IPC.
 */

/**
 * Renderer-safe token estimate. Returns the integer token count for
 * `text` against `modelId`. Never throws.
 *
 * Mid-stream synthetic usage only needs a monotonic approximation;
 * authoritative counts come from provider `token-usage` frames and
 * the IPC pre-flight estimate.
 */
export function tokenizeForModel(_modelId: string, text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / 3.8);
}
