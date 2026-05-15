/**
 * OpenAI-compatible streaming chat transport. POSTs to
 * `${baseUrl}/v1/chat/completions` with `stream: true` and parses
 * Server-Sent Events into `ChatStreamDelta` objects. Compatible with
 * OpenAI, DeepSeek, Ollama (OpenAI shim), LM Studio, vLLM, Groq,
 * Together, etc.
 *
 * This file is called only through `chatClient.streamChat()` — it should
 * NOT be imported directly from anywhere else in the codebase so the
 * dialect-routing policy stays in one place.
 */

import type { ChatStreamRequest, ChatStreamDelta } from './chatClient.js';
import type { ProviderWithKey } from '@shared/types/provider.js';
import { logger } from '../logging/logger.js';
import { classifyProviderError } from './providerError.js';
import { acquire, markRateLimited, markSuccess } from './providerRateGuard.js';
import { createInactivityWatch, isStreamInactivityError } from './streamInactivity.js';
import { buildAttributionHeaders } from './attributionHeaders.js';

const log = logger.child('providers/chat/openai');

interface RawSseChoice {
  index?: number;
  delta?: {
    role?: string;
    content?: string | null;
    /** DeepSeek thinking-mode reasoning chunk. */
    reasoning_content?: string | null;
    tool_calls?: Array<{
      index?: number;
      id?: string;
      type?: string;
      function?: { name?: string; arguments?: string };
    }>;
  };
  finish_reason?: string | null;
}

interface RawSseChunk {
  choices?: RawSseChoice[];
  /**
   * OpenAI-compat final usage frame. `choices` is usually `[]` in that
   * frame — the whole chunk is just the usage report. Some providers
   * (DeepSeek v4-pro, Groq) may instead attach `usage` to the last
   * content chunk, so we always check and emit once regardless of where
   * it lands. Anthropic's `/v1/messages` dialect uses a different event
   * stream entirely and is not handled here.
   */
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/**
 * Async-generator that yields deltas as they arrive. Caller is responsible for
 * accumulating them.
 */
export async function* streamOpenAi(
  req: ChatStreamRequest,
  provider: ProviderWithKey
): AsyncGenerator<ChatStreamDelta> {
  const url = `${provider.baseUrl}/v1/chat/completions`;
  const body: Record<string, unknown> = {
    model: req.model,
    messages: req.messages,
    stream: true,
    // Ask the provider to emit a final usage frame so we can surface real
    // prompt/completion/total token counts to the UI. Universal across
    // OpenAI-compat providers. Providers that don't understand the flag
    // ignore it silently — we gracefully degrade to pre-flight BPE
    // estimates.
    stream_options: { include_usage: true }
  };
  if (req.tools && req.tools.length > 0) {
    body['tools'] = req.tools;
    body['tool_choice'] = req.toolChoice ?? 'auto';
  } else if (req.toolChoice !== undefined) {
    // Caller set `tool_choice` WITHOUT attaching tools. The SubAgent
    // wrap-up turn does this: it re-issues the final iteration with
    // `toolChoice: 'none'` to force the model to emit prose instead of
    // more tool calls. The old guard (`tools.length > 0`) silently
    // dropped the field, so the wrap-up hint had no effect and the
    // sub-agent often kept calling tools right up until the 16-turn
    // cap. `'none'` / `'auto'` / `'required'` are all meaningful
    // without a `tools` array — OpenAI and the major compat providers
    // accept the bare directive. Forward it through verbatim.
    body['tool_choice'] = req.toolChoice;
  }
  if (typeof req.temperature === 'number') body['temperature'] = req.temperature;
  if (typeof req.maxTokens === 'number') body['max_tokens'] = req.maxTokens;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    // Attribution: only attached when the host is OpenRouter (or the
    // user has stored an explicit override). Sent on every chat call
    // — and on `/v1/models` discovery — so OpenRouter's public
    // rankings page sees a single, consistent attribution. See
    // `attributionHeaders.ts` for the resolution rules.
    ...buildAttributionHeaders(provider)
  };
  if (provider.apiKey) headers['Authorization'] = `Bearer ${provider.apiKey}`;

  // Inactivity watchdog — wraps the caller's signal so a silent SSE
  // connection can't hang the run forever. The watchdog's combined
  // signal aborts either when (a) the caller's run-scoped signal fires
  // (user Stop) or (b) no bytes arrive within STREAM_INACTIVITY_TIMEOUT_MS.
  // Both branches surface through `fetch`'s reject / `reader.read()`'s
  // throw; the `catch` around the read loop distinguishes them via
  // `isStreamInactivityError` for structured logging.
  const watch = createInactivityWatch(
    req.signal ? { parent: req.signal } : {}
  );

  // Adaptive rate guard. Sleeps any concurrent caller until a sibling
  // worker's prior 429 cools off — see `providerRateGuard.ts` for the
  // full rationale (sub-agent pool thundering herd).
  await acquire(req.providerId, watch.signal);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: watch.signal
    });
  } catch (err: unknown) {
    watch.dispose();
    if (isStreamInactivityError(err)) {
      log.warn('provider stream inactive before headers', { url, providerId: req.providerId });
    }
    throw err;
  }

  if (!res.ok || !res.body) {
    watch.dispose();
    const errBody = res.body ? await safeText(res) : '';
    log.warn('chat completions request failed', {
      status: res.status,
      statusText: res.statusText,
      url
    });
    if (res.status === 429 || res.status >= 500) {
      // Same staggering contract as the Ollama transport: feed the
      // gate so sibling workers don't dog-pile during a cooldown.
      markRateLimited(req.providerId);
    }
    throw classifyProviderError({
      status: res.status,
      statusText: res.statusText,
      url,
      body: errBody,
      surface: 'chat',
      providerId: req.providerId,
      providerName: provider.name
    });
  }

  // Healthy response — clear any cooldown the gate was holding so
  // sibling workers stop waiting immediately.
  markSuccess(req.providerId);

  // Headers received and body is open — fire the connect hook so the
  // caller can flip its UI status from `connecting` to `awaiting-
  // response`. Wrapped in try/catch so a buggy listener can never abort
  // the stream we're about to read.
  if (req.onConnect) {
    try {
      req.onConnect();
    } catch (err) {
      log.warn('onConnect listener threw; continuing to read stream', { err });
    }
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  // Frame parser extracted so the same logic runs on both normal reads
  // AND on the final buffer flush after the stream closes. Yields any
  // deltas parsed from the frame; returns `true` if the payload was
  // `[DONE]` (caller should stop iterating).
  async function* parseFrame(frame: string): AsyncGenerator<ChatStreamDelta, boolean> {
    const dataLine = frame
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.startsWith('data:'));
    if (!dataLine) return false;
    const payload = dataLine.slice(5).trim();
    if (payload === '[DONE]') return true;
    let chunk: RawSseChunk;
    try {
      chunk = JSON.parse(payload) as RawSseChunk;
    } catch {
      return false;
    }
    if (chunk.usage) {
      const u = chunk.usage;
      const prompt = typeof u.prompt_tokens === 'number' ? u.prompt_tokens : 0;
      const completion = typeof u.completion_tokens === 'number' ? u.completion_tokens : 0;
      const total =
        typeof u.total_tokens === 'number' ? u.total_tokens : prompt + completion;
      yield {
        usage: {
          promptTokens: prompt,
          completionTokens: completion,
          totalTokens: total
        }
      };
    }
    const choice = chunk.choices?.[0];
    if (!choice) return false;
    const delta = choice.delta ?? {};
    if (typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0) {
      yield { reasoningDelta: delta.reasoning_content };
    }
    if (typeof delta.content === 'string' && delta.content.length > 0) {
      yield { contentDelta: delta.content };
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const toolCallDelta: ChatStreamDelta['toolCallDelta'] = {
          index: tc.index ?? 0
        };
        if (tc.id !== undefined) toolCallDelta.id = tc.id;
        if (tc.function?.name !== undefined) toolCallDelta.name = tc.function.name;
        if (tc.function?.arguments !== undefined) {
          // OpenAI spec types `arguments` as a string (a JSON-encoded
          // payload accumulated across deltas), but several "OpenAI-
          // compatible" backends (some Ollama-shim modes, certain
          // self-hosted gateways) deliver it as a JSON OBJECT instead.
          // Forwarding the object verbatim breaks the downstream
          // accumulator (`argumentsBuf += delta.argumentsDelta` would
          // coerce it to the literal string "[object Object]"), and
          // the model's tool call would silently land at the executor
          // with `args = {}`. Normalize to a string here so the
          // accumulator semantics hold for every dialect.
          const raw = tc.function.arguments as unknown;
          toolCallDelta.argumentsDelta =
            typeof raw === 'string' ? raw : JSON.stringify(raw ?? {});
        }
        yield { toolCallDelta };
      }
    }
    if (choice.finish_reason) {
      yield { finishReason: choice.finish_reason };
    }
    return false;
  }

  try {
    while (true) {
      let readResult: ReadableStreamReadResult<Uint8Array>;
      try {
        readResult = await reader.read();
      } catch (err) {
        if (isStreamInactivityError(err)) {
          log.warn('provider stream inactive mid-read', {
            url,
            providerId: req.providerId
          });
        }
        throw err;
      }
      const { value, done } = readResult;
      // Any read that returned something (even a zero-length chunk on
      // some transports) counts as liveness.
      if (value && value.length > 0) watch.poke();
      if (done) {
        // Flush any remaining buffered bytes (decoder's internal state
        // plus any trailing partial frames) before exiting. Well-behaved
        // servers terminate every frame with the separator, but a
        // dropped connection mid-frame would otherwise silently lose
        // the final usage report — or worse, a dropped connection
        // between TWO already-terminated frames (e.g. last content
        // chunk + final usage chunk) that are sitting in the buffer
        // unseparated by a trailing `\n\n` at EOF.
        //
        // The previous implementation ran `parseFrame(tail)` exactly
        // once on the whole buffer. `parseFrame` picks the FIRST
        // `data:` line it finds, so a buffer holding
        // `data: {chunk}\n\ndata: {usage}` (no trailing separator)
        // yielded only `{chunk}` and silently dropped `{usage}`. We
        // now run the same `\n\n` loop the hot path uses AND a final
        // single-frame parse on whatever remains, so every pending
        // frame is drained regardless of how the connection closed.
        buffer += decoder.decode().replace(/\r\n/g, '\n');
        let tailSep: number;
        while ((tailSep = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, tailSep);
          buffer = buffer.slice(tailSep + 2);
          const gen = parseFrame(frame);
          let res = await gen.next();
          while (!res.done) {
            yield res.value;
            res = await gen.next();
          }
          if (res.value === true) {
            // `[DONE]` in the tail — mirror the hot-loop early return
            // so we don't keep trying to parse the remaining buffer.
            return;
          }
        }
        const tail = buffer.trim();
        if (tail.length > 0) {
          const gen = parseFrame(tail);
          let res = await gen.next();
          while (!res.done) {
            yield res.value;
            res = await gen.next();
          }
        }
        break;
      }
      // Normalize CRLF → LF at the byte-boundary to survive SSE streams
      // that terminate frames with `\r\n\r\n` (RFC-compliant; emitted by
      // several Windows-hosted providers — LM Studio, certain vLLM
      // builds). A naive `indexOf('\n\n')` scan would never split a
      // CRLF-style stream and `buffer` would grow unbounded until the
      // caller aborted the run. Normalization is safe because the inner
      // frame parser already trims each line.
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

      // SSE frames are separated by a blank line (two LFs after the CRLF
      // normalization above).
      let sepIdx: number;
      while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, sepIdx);
        buffer = buffer.slice(sepIdx + 2);
        // Route the frame through the shared parser. `[DONE]` triggers
        // an early return after cancelling the body; all other frames
        // yield zero-or-more deltas through the generator.
        const gen = parseFrame(frame);
        let res = await gen.next();
        while (!res.done) {
          yield res.value;
          res = await gen.next();
        }
        if (res.value === true) {
          // `[DONE]` — proactively cancel the underlying body stream so
          // the HTTP connection closes promptly instead of waiting for
          // GC. `releaseLock()` in the `finally` block is not enough —
          // it detaches the reader but leaves the response body open.
          try {
            await reader.cancel();
          } catch {
            /* noop */
          }
          return;
        }
      }
    }
  } finally {
    // Always dispose the watchdog FIRST so a post-stream teardown can't
    // race a pending timer into an already-closed stream.
    watch.dispose();
    try {
      reader.releaseLock();
    } catch {
      /* noop */
    }
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 1000);
  } catch {
    return '';
  }
}
