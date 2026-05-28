/**
 * Shared SSE byte-stream → frame splitter.
 *
 * Owns the stateful work that's identical across every Server-Sent
 * Events transport we ship:
 *
 *   - CRLF normalization at the byte boundary (RFC-compliant SSE
 *     servers may end frames with `\r\n\r\n`; a naive `\n\n` scanner
 *     would never split a CRLF-only stream and the buffer would
 *     grow unbounded until the caller aborted).
 *   - Frame separation on `\n\n`.
 *   - EOF flush — drain whichever frames are still in the buffer when
 *     the connection closes WITHOUT a trailing separator (a dropped
 *     connection mid-stream would otherwise silently lose the final
 *     usage report).
 *   - Inactivity-watchdog poke on every read that returned bytes.
 *
 * The caller is responsible for the per-dialect frame parsing
 * (`data: …` / `event: …` / `[DONE]`). Each yielded value is the raw
 * frame body — exactly what was between two `\n\n` separators.
 *
 * Used by `openaiChatStream`, `anthropicChatStream`, and
 * `geminiChatStream`. The extraction targets the byte → frame layer
 * SPECIFICALLY (not the JSON parsing) because that's the layer where
 * dialects truly converge — every SSE-over-HTTP source uses the same
 * frame format regardless of the JSON shape inside.
 *
 * Pure of all transport concerns: takes a `ReadableStream<Uint8Array>`
 * and an inactivity watchdog handle. Does NOT own the HTTP request,
 * does NOT decide the cancel policy, does NOT route by status code.
 * Those concerns stay with each transport so dialect-specific
 * behavior (e.g. Anthropic's mid-stream `error` event, Gemini's
 * non-DONE termination) doesn't bleed into the shared helper.
 */

import { isStreamInactivityError } from './streamInactivity.js';

interface SseInactivityWatch {
  /** Combined caller signal + idle-timeout signal. */
  readonly signal: AbortSignal;
  /** Called on every read that returned at least one byte. */
  poke(): void;
}

interface SseReadOptions {
  /** Open response body stream. The reader is acquired internally. */
  body: ReadableStream<Uint8Array>;
  /** Inactivity watchdog — its `signal` is honored by `reader.read()`. */
  watch: SseInactivityWatch;
  /**
   * Hook invoked when an `await reader.read()` throws because the
   * inactivity timer fired. The caller wants this for structured
   * logging ("provider stream inactive mid-read") — it does NOT
   * affect control flow (the original error rethrows either way).
   */
  onInactivity?: () => void;
  /**
   * Called when the byte-level read loop encounters an error while
   * reading the body. Keeps the warn-log location next to the
   * provider-name context the caller already has. Called BEFORE the
   * error is rethrown.
   */
  onReadError?: (err: unknown) => void;
}

/**
 * Async-generator that yields raw SSE frame bodies (the text between
 * `\n\n` separators) as they arrive on the wire. Each frame is
 * trimmed-of-trailing-newline-only — leading/trailing whitespace
 * inside the frame is preserved so the caller can do its own line-
 * level parsing.
 *
 * Cancellation contract:
 *   - When the caller does `for await … of readSseFrames(…) { break; }`
 *     the generator's `return()` cleanup runs and we cancel the
 *     underlying body reader, closing the HTTP socket promptly.
 *   - When the inactivity watchdog fires, `reader.read()` throws
 *     and we let it propagate after firing `onInactivity`.
 *   - When the body ends cleanly, we flush any buffered frame(s)
 *     and any remaining trailing partial frame as a final yield.
 */
export async function* readSseFrames(opts: SseReadOptions): AsyncGenerator<string> {
  const { body, watch, onInactivity, onReadError } = opts;
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      let readResult: ReadableStreamReadResult<Uint8Array>;
      try {
        readResult = await reader.read();
      } catch (err) {
        if (isStreamInactivityError(err) && onInactivity) onInactivity();
        if (onReadError) onReadError(err);
        throw err;
      }
      const { value, done } = readResult;
      if (value && value.length > 0) watch.poke();
      if (done) {
        // Flush any remaining buffered bytes (decoder's internal
        // state plus any trailing partial frames) before exiting.
        // Well-behaved servers terminate every frame with the
        // separator, but a dropped connection mid-frame would
        // otherwise silently lose the final usage report — or
        // worse, a dropped connection between TWO already-
        // terminated frames sitting in the buffer unseparated by
        // a trailing `\n\n` at EOF.
        buffer += decoder.decode().replace(/\r\n/g, '\n');
        let tailSep: number;
        while ((tailSep = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, tailSep);
          buffer = buffer.slice(tailSep + 2);
          yield frame;
        }
        const tail = buffer.trim();
        if (tail.length > 0) yield tail;
        return;
      }
      // Normalize CRLF → LF at the byte boundary so a naive
      // `indexOf('\n\n')` scan still splits frames on RFC-compliant
      // SSE streams that terminate with `\r\n\r\n` (LM Studio,
      // certain vLLM builds, etc.).
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

      let sepIdx: number;
      while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, sepIdx);
        buffer = buffer.slice(sepIdx + 2);
        yield frame;
      }
    }
  } finally {
    // Detach the reader and proactively cancel the body so the HTTP
    // socket closes promptly instead of waiting for GC. `cancel()`
    // is a no-op once `releaseLock()` has run, so we cancel FIRST.
    try {
      await reader.cancel();
    } catch {
      /* noop */
    }
    try {
      reader.releaseLock();
    } catch {
      /* noop */
    }
  }
}

/**
 * Helper that picks the `data:` line out of an SSE frame body. SSE
 * frames may carry `event:`, `id:`, `retry:`, comments (`:`), and
 * multiple `data:` lines; for chat APIs we only care about the
 * single-line `data:` payload. Multi-line `data:` (RFC-compliant —
 * the spec says join with `\n`) is concatenated correctly here so a
 * conformant server using line-folded JSON still works.
 *
 * Returns `null` when the frame has no `data:` line (pure event-only
 * frames, comments, keepalives).
 */
export function pickSseDataLine(frame: string): string | null {
  const lines = frame.split('\n');
  const dataChunks: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('data:')) dataChunks.push(line.slice(5).trim());
  }
  if (dataChunks.length === 0) return null;
  return dataChunks.join('\n');
}

