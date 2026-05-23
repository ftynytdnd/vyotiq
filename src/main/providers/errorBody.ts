/**
 * Provider error-body helper.
 *
 * Audit fix 2026-05-P2-1: every transport (`openaiChatStream`,
 * `anthropicChatStream`, `geminiChatStream`, `ollamaChatStream`) and
 * the model-discovery fetchers had a near-identical `safeText(res)`
 * inline:
 *
 * ```
 * async function safeText(res: Response): Promise<string> {
 *   try {
 *     return (await res.text()).slice(0, 1000);
 *   } catch {
 *     return '';
 *   }
 * }
 * ```
 *
 * Five copies, one of them (modelDiscovery) capped at 500 instead of
 * 1 000 — a copy-paste drift that meant a 4xx body of the same length
 * surfaced two different previews depending on which code path read
 * it. This helper consolidates the five copies into one and accepts
 * an explicit `maxChars` so the call site spells out its preview cap.
 *
 * The implementation uses streaming UTF-8 decode + reader cancellation
 * via `readResponseBodyWithCap` so a hostile/misconfigured endpoint
 * cannot OOM the main process by streaming a multi-GB error body
 * (defense-in-depth — the search tool's per-result cap covers the
 * happy outbound path; this is the error-body path).
 */

const STREAM_BODY_BYTE_CAP = 1024 * 1024;

export async function safeText(
  res: Response,
  maxChars: number = 1000
): Promise<string> {
  if (!res.body) {
    try {
      const text = await res.text();
      return text.length > maxChars ? text.slice(0, maxChars) : text;
    } catch {
      return '';
    }
  }
  try {
    const raw = await readResponseBodyWithCap(res, STREAM_BODY_BYTE_CAP);
    return raw.length > maxChars ? raw.slice(0, maxChars) : raw;
  } catch {
    return '';
  }
}

/**
 * Stream-read a `fetch` response body into a UTF-8 string, hard-capped
 * at `maxBytes`. Mirrors `search.tool.ts`'s `readBodyWithCap` (audit
 * fix 2026-04-P2-3) — kept private here so the search tool can keep
 * its own copy specialised for the per-call 1 MB allowance without an
 * import cycle into a provider module.
 *
 * Once the cap is hit the underlying reader is cancelled so the rest
 * of the upstream body is dropped on the floor. The TextDecoder runs
 * in stream mode so multi-byte UTF-8 codepoints straddling a chunk
 * boundary aren't replaced with U+FFFD; the final `decoder.decode()`
 * flushes the trailing state.
 */
async function readResponseBodyWithCap(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) {
    const text = await res.text();
    return text.length > maxBytes ? text.slice(0, maxBytes) : text;
  }
  const decoder = new TextDecoder('utf-8');
  let total = 0;
  let out = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const room = maxBytes - total;
      if (value.byteLength <= room) {
        total += value.byteLength;
        out += decoder.decode(value, { stream: true });
        continue;
      }
      if (room > 0) {
        out += decoder.decode(value.subarray(0, room), { stream: true });
        total += room;
      }
      try {
        await reader.cancel();
      } catch {
        /* cancel failures are safe to ignore */
      }
      break;
    }
  } finally {
    out += decoder.decode();
  }
  return out;
}
