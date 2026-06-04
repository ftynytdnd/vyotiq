/**
 * Ollama-native streaming chat transport. POSTs to
 * `${baseUrl}/api/chat` with `stream: true` and parses NDJSON
 * (newline-delimited JSON) frames into the SHARED `ChatStreamDelta`
 * shape so the orchestrator loop above never has to care which
 * dialect is in use.
 *
 * Wire spec (per https://docs.ollama.com/cloud and
 * https://github.com/ollama/ollama/blob/main/docs/api.md):
 *
 *   - One complete JSON object per `\n`-separated line.
 *   - Non-final frames:  `{ message: { role, content, thinking?, tool_calls? }, done: false }`
 *   - Final frame:       `{ message: { role, content: "" }, done: true,
 *                            done_reason?, prompt_eval_count?, eval_count?, ... }`
 *   - `message.tool_calls[]` arrives COMPLETE in a single frame
 *     (no incremental token-level deltas). No id / index; we synthesize
 *     them here so downstream consumers can reuse the OpenAI pipeline.
 *
 * This file is called only through `chatClient.streamChat()` — it
 * should NOT be imported directly from anywhere else in the codebase
 * so the dialect-routing policy stays in one place.
 */

import { randomUUID } from 'node:crypto';
import type { ChatStreamRequest, ChatStreamDelta } from './chatClient.js';
import type { ChatMessage } from '@shared/types/chat.js';
import type { ProviderWithKey } from '@shared/types/provider.js';
import { logger } from '../logging/logger.js';
import { classifyProviderError, ProviderError, looksRateLimited } from './providerError.js';
import { acquire, markRateLimited, markSuccess } from './providerRateGuard.js';
import { createInactivityWatch, isStreamInactivityError } from './streamInactivity.js';
import { safeText } from './errorBody.js';
import { mapOllamaThink, resolveThinkingEffort } from '@shared/providers/thinkingEffort.js';

const log = logger.child('providers/chat/ollama');

interface OllamaToolCall {
  function?: {
    name?: string;
    /**
     * Ollama emits `arguments` as a JSON OBJECT in the documented schema,
     * not a stringified JSON payload like OpenAI. We re-serialize on the
     * way out so `consumeChatStream.argumentsBuf` concatenation remains
     * valid. In practice some Ollama Cloud builds / upstream proxies
     * deliver an already-stringified payload — `framesToDeltas` accepts
     * either shape.
     */
    arguments?: Record<string, unknown> | string;
  };
}

interface OllamaChatFrame {
  message?: {
    role?: string;
    content?: string;
    thinking?: string;
    tool_calls?: OllamaToolCall[];
  };
  done?: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  /**
   * Mid-stream error envelope. Ollama emits `{"error":"..."}` as its own
   * NDJSON line when the model fails after streaming has begun
   * (context-length overflow, backend OOM, cloud-side model crash,
   * etc.). Absent from the public schema but confirmed in practice on
   * both `ollama.com` and local daemons. We promote the envelope into
   * a thrown `ProviderError` so `runLoop`'s self-correction path kicks
   * in instead of the caller seeing a silent empty completion.
   *
   * Shape varies: sometimes `"..."`, sometimes `{ message: "..." }`.
   * Both forms are handled in `processLine`.
   */
  error?: string | { message?: string };
}

/**
 * Async-generator that yields deltas as they arrive. Caller is
 * responsible for accumulating them. Surface is identical to
 * `streamOpenAi` so the consumer can treat them interchangeably.
 */
export async function* streamOllama(
  req: ChatStreamRequest,
  provider: ProviderWithKey
): AsyncGenerator<ChatStreamDelta> {
  const url = `${provider.baseUrl}/api/chat`;
  // Ollama native accepts `options.temperature` / `options.num_predict`
  // (output-token cap) rather than top-level `temperature` / `max_tokens`
  // like OpenAI. Tool schema shape `{ type:'function', function: {...} }`
  // is the same on both sides, so `req.tools` forwards as-is.
  //
  // WE DO NOT SET `num_ctx`. `num_ctx` is the TOTAL context window (prompt
  // + completion), not an output cap. An earlier version mapped
  // `req.maxTokens` → `num_ctx`, which silently truncated prompts any
  // time `maxTokens` was smaller than the system harness and produced an
  // HTTP 400 on Ollama Cloud. The correct knob for "max output tokens"
  // is `num_predict`; the model's own ceiling for `num_ctx` stays the
  // default unless a user explicitly needs to override it.
  const options: Record<string, unknown> = {};
  if (typeof req.temperature === 'number') options['temperature'] = req.temperature;
  if (typeof req.maxTokens === 'number') options['num_predict'] = req.maxTokens;

  const body: Record<string, unknown> = {
    model: req.model,
    // Translate OpenAI-shaped `ChatMessage[]` into Ollama's native
    // message schema. See `toOllamaMessages` for the exact
    // transformations (null→'', arguments string→object, extra field
    // removal). A raw `req.messages` forward-pass was what triggered
    // the 400 storm on Ollama Cloud for any conversation that contained
    // a prior tool-call turn.
    messages: toOllamaMessages(req.messages),
    stream: true
  };
  if (req.tools && req.tools.length > 0) body['tools'] = req.tools;
  if (Object.keys(options).length > 0) body['options'] = options;
  // Thinking-effort (2026). Ollama exposes a boolean `think` toggle on
  // `/api/chat` (see docs.ollama.com/capabilities/thinking); any
  // non-`off` effort enables it. Only sent when the user expressed a
  // preference so non-thinking models aren't forced.
  const ollamaEffort = req.reasoningEffort ?? resolveThinkingEffort(provider, req.model);
  if (ollamaEffort !== undefined) body['think'] = mapOllamaThink(ollamaEffort);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    // Ollama's daemon serves `application/x-ndjson` for streams; cloud
    // returns `application/json` line-by-line. Either way we parse
    // by newline ourselves — the Accept header is best-effort.
    Accept: 'application/x-ndjson, application/json'
  };
  if (provider.apiKey) headers['Authorization'] = `Bearer ${provider.apiKey}`;

  // Inactivity watchdog — see `streamInactivity.ts`. Guards against a
  // silent NDJSON connection (the Ollama daemon keeps the socket open
  // but never writes a frame) that would otherwise hang the run.
  const watch = createInactivityWatch(
    req.signal ? { parent: req.signal } : {}
  );

  // Adaptive rate guard. If a sibling worker just received 429 from
  // this provider, sleep until the gate's cooldown expires before we
  // pile on. No-op when the provider is healthy. See
  // `providerRateGuard.ts` for the full rationale (concurrent stream
  // thundering herd).
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
    // Include the body when logging non-2xx so a 400 "bad request" on
    // Ollama Cloud is actually triageable — Ollama returns useful JSON
    // error messages there (`{"error":"model not found"}`,
    // `{"error":"json: cannot unmarshal string into Go struct field …"}`,
    // etc.) and silently dropping the body costs hours of triage.
    log.warn('chat completions request failed', {
      status: res.status,
      statusText: res.statusText,
      url,
      body: errBody
    });
    // Feed the rate guard so sibling workers in the same pool stagger
    // their next attempt instead of dog-piling. Only 429 / 5xx flip
    // the cooldown — 4xx body errors (auth, bad request, model not
    // found) are caller-fault and re-firing immediately is fine.
    if (res.status === 429 || res.status >= 500) {
      // Let the gate auto-escalate based on consecutive observations
      // (see `markRateLimited` for the AIMD-style attempt ladder).
      // Sibling workers in the same pool naturally stagger because a
      // single shared cooldown is observed by every `acquire` call
      // for this provider until either the deadline expires or a
      // healthy response calls `markSuccess`.
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

  // Healthy response — drop any cooldown the gate was holding so
  // sibling workers stop waiting the moment we know the provider is
  // serving again. Fired BEFORE we read the body so even slow streams
  // unblock siblings immediately.
  markSuccess(req.providerId);

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
  // Each Ollama response is a single assistant turn that may carry
  // tool_calls across ONE OR MORE NDJSON frames. We need stable ids so
  // the consumer's index→id mapping works; OpenAI provides them, Ollama
  // does not, so we mint one per turn.
  const turnId = randomUUID();
  // Stream-local CUMULATIVE tool-call index counter. Wrapped in a
  // mutable holder so `framesToDeltas` (a top-level function) can
  // increment it across frames without us having to thread the value
  // back through a return tuple.
  //
  // Why cumulative (regression — observed live with `glm-4.7` on
  // `https://ollama.com/api/chat`): some Ollama-Cloud models emit
  // PARALLEL tool calls across multiple NDJSON frames, each frame
  // carrying its own `tool_calls: [{...}]` of length 1. The previous
  // implementation used the per-frame array index `i` for
  // `toolCallDelta.index`, so the second call's chunk arrived with
  // `index: 0` and `consumeChatStream` concatenated its arguments
  // into the first call's `argumentsBuf` — `parseToolArgs` then
  // failed with "Unexpected non-whitespace character after JSON".
  // The visible symptom was a memory tool call buffer of
  // `{"action":"list","scope":"global"}{"action":"list","scope":"workspace"}`
  // (two complete JSONs) and the run hitting the 3-strike halt.
  // Tracking a single monotonic counter PER STREAM solves both the
  // multi-frame case and the (rarer) multi-call-per-frame case
  // uniformly because each tool call gets its own slot regardless of
  // how the provider chose to chunk them.
  const toolIndexState = { next: 0 };

  // Line processor shared between the hot loop and the final flush. A
  // connection that drops mid-frame (no trailing `\n`) would otherwise
  // silently lose the final `done: true` frame — including the eval
  // counts that drive token usage telemetry. Returns `true` if the
  // frame's `done` flag was set, signalling the caller to stop reading.
  async function* processLine(line: string): AsyncGenerator<ChatStreamDelta, boolean> {
    const trimmed = line.trim();
    if (trimmed.length === 0) return false;
    let frame: OllamaChatFrame;
    try {
      frame = JSON.parse(trimmed) as OllamaChatFrame;
    } catch {
      // Malformed line — skip (mirrors OpenAI path's "continue" on
      // a bad SSE payload). The provider MAY intersperse non-JSON
      // keep-alive comments on long-polling connections.
      return false;
    }
    // Mid-stream error envelope (`{"error":"..."}`). Before this branch
    // existed, such a line produced zero deltas and the caller saw a
    // clean EOF with no content — the user stared at a stuck spinner
    // that silently finished with an empty response. Promote it to a
    // `ProviderError` so `runLoop`'s self-correction path kicks in
    // (and the three-strike budget applies just like any other
    // provider failure).
    //
    // We construct the ProviderError directly rather than routing
    // through `classifyProviderError(status=…)` because the HTTP
    // response was already 200 and the standard `describe()` messages
    // all assume an HTTP failure. The provider's own error text is the
    // single most useful piece of information here.
    //
    // Rate-limit detection (audit A-17): Ollama Cloud emits saturation
    // errors mid-stream once a connection has been accepted (the HTTP
    // response was 200; the `{"error":"too many concurrent requests"}`
    // envelope arrives on the body). The initial-rejection branch
    // above feeds `markRateLimited` only on 429 / 5xx HTTP statuses,
    // so without this path sibling concurrent streams in the same pool would
    // dog-pile on retry instead of staggering. We sniff the error
    // text for rate-limit phrasing and feed the gate BEFORE throwing,
    // and promote the `ProviderError.kind` to `'rate-limit'` so the
    // renderer's timeline renders the matching friendly message.
    if (frame.error !== undefined) {
      const errMsg =
        typeof frame.error === 'string'
          ? frame.error
          : typeof frame.error.message === 'string'
            ? frame.error.message
            : 'Unknown mid-stream error from provider.';
      const rateLimited = looksRateLimited(errMsg);
      if (rateLimited) {
        markRateLimited(req.providerId);
      }
      throw new ProviderError({
        kind: rateLimited ? 'rate-limit' : 'server',
        status: 200,
        providerId: req.providerId,
        providerName: provider.name,
        friendlyMessage: rateLimited
          ? `${provider.name}: Rate limit exceeded (mid-stream) — ${errMsg}`
          : `${provider.name}: Mid-stream error — ${errMsg}`,
        surface: 'chat',
        rawBody: trimmed
      });
    }
    for (const d of framesToDeltas(frame, turnId, toolIndexState)) {
      yield d;
    }
    return frame.done === true;
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
      if (value && value.length > 0) watch.poke();
      if (done) {
        // Drain the decoder and process any trailing frame that didn't
        // end with a newline. Rare in practice — Ollama terminates every
        // NDJSON line — but a dropped connection mid-frame would
        // otherwise silently strip the final `done: true` usage payload.
        buffer += decoder.decode().replace(/\r\n/g, '\n');
        if (buffer.length > 0) {
          const gen = processLine(buffer);
          let res = await gen.next();
          while (!res.done) {
            yield res.value;
            res = await gen.next();
          }
          buffer = '';
        }
        break;
      }
      // Normalize CRLF → LF defensively (Windows-hosted daemons).
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx);
        buffer = buffer.slice(newlineIdx + 1);
        const gen = processLine(line);
        let res = await gen.next();
        while (!res.done) {
          yield res.value;
          res = await gen.next();
        }
        if (res.value === true) {
          // Final frame — close body and stop reading. Synthetic usage
          // delta was already yielded inside `framesToDeltas` if the
          // server populated the eval counts.
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
    watch.dispose();
    try {
      reader.releaseLock();
    } catch {
      /* noop */
    }
  }
}

/**
 * Mutable state holder for the stream-local cumulative tool-call
 * index. The streaming generator owns one of these per turn and
 * passes it into `framesToDeltas` so multi-frame parallel tool
 * calls each receive their own slot in the consumer's
 * `partialToolCalls[]` array. See the regression note in
 * `streamOllama` for the failure mode this addresses.
 */
interface ToolIndexState {
  next: number;
}

/**
 * Translate a single NDJSON frame into zero or more `ChatStreamDelta`
 * entries. Split out so the order of emission matches `streamOpenAi`:
 * reasoning → content → tool_calls → finishReason / usage.
 *
 * `idxState` is the cumulative tool-call index counter the streaming
 * generator threads through every frame for the same turn — see the
 * comment block at `toolIndexState` in `streamOllama` for why this
 * MUST persist across frames.
 */
function* framesToDeltas(
  frame: OllamaChatFrame,
  turnId: string,
  idxState: ToolIndexState
): Generator<ChatStreamDelta> {
  const msg = frame.message ?? {};

  // Reasoning first so `consumeChatStream.maybeCloseReasoning` can fire
  // on the same frame as the first content token when a provider
  // packs both into one NDJSON line (rare but possible for thinking
  // models on cloud Ollama). Mirrors the `streamOpenAi` ordering.
  if (typeof msg.thinking === 'string' && msg.thinking.length > 0) {
    yield { reasoningDelta: msg.thinking };
  }

  if (typeof msg.content === 'string' && msg.content.length > 0) {
    yield { contentDelta: msg.content };
  }

  if (Array.isArray(msg.tool_calls)) {
    for (const tc of msg.tool_calls) {
      if (!tc || !tc.function) continue;
      const name = tc.function.name;
      if (!name) continue;
      // Ollama documents `arguments` as an OBJECT, but some cloud
      // builds / upstream proxies deliver an already-stringified JSON
      // payload. Pass strings through untouched and only stringify
      // objects — `JSON.stringify` of a string would otherwise produce
      // a doubly-quoted scalar that parses back to a string, leaving
      // the executor with `args = "..."` instead of a record and
      // surfacing as a misleading "missing <param>" error downstream.
      // No partial streaming on this transport — a single
      // `argumentsDelta` carries the full payload. Live diff UI on
      // Ollama therefore appears as an instant full preview (with
      // auto-expanded tool rows) rather than frame-by-frame growth;
      // incremental `diff-stream` cadence requires OpenAI/Anthropic.
      const rawArgs = tc.function.arguments;
      const argsJson =
        typeof rawArgs === 'string'
          ? rawArgs.length > 0
            ? rawArgs
            : '{}'
          : rawArgs !== undefined
            ? JSON.stringify(rawArgs)
            : '{}';
      // Allocate the next CUMULATIVE index for this tool call. Reads
      // and increments the stream-local counter so a parallel call
      // arriving in a later frame gets a fresh slot in
      // `partialToolCalls[]` instead of colliding on slot 0. The
      // synthesized id is built from the same counter so id and
      // index stay 1:1 (lets the consumer pair them by either key
      // without ambiguity).
      const idx = idxState.next++;
      yield {
        toolCallDelta: {
          index: idx,
          id: `ol-${turnId}-${idx}`,
          name,
          argumentsDelta: argsJson
        }
      };
    }
  }

  if (frame.done === true) {
    // Synthetic usage frame. `prompt_eval_count` = prompt tokens
    // consumed; `eval_count` = completion tokens emitted.
    const prompt = typeof frame.prompt_eval_count === 'number' ? frame.prompt_eval_count : 0;
    const completion = typeof frame.eval_count === 'number' ? frame.eval_count : 0;
    if (prompt > 0 || completion > 0) {
      yield {
        usage: {
          promptTokens: prompt,
          completionTokens: completion,
          totalTokens: prompt + completion
        }
      };
    }
    // Map `done_reason` → finishReason. Ollama uses `stop` / `length`
    // (same vocabulary as OpenAI) when the field is populated; if
    // absent, assume a clean stop.
    yield { finishReason: frame.done_reason ?? 'stop' };
  }
}


/** Shape of a single message on the Ollama `/api/chat` wire. */
interface OllamaWireMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /**
   * Echo of the assistant's reasoning trace from the previous turn.
   *
   * Ollama's `/api/chat` endpoint surfaces a thinking-capable model's
   * chain-of-thought through a dedicated `message.thinking` field —
   * see `https://docs.ollama.com/capabilities/thinking`. Ollama
   * preserves the trace across multi-turn conversations IFF the
   * client echoes the field back on the next request. Without this
   * echo, a model that planned in `thinking` and emitted only a one-
   * line announcement in `content` (a common harness §A Phase 3 +
   * §B "Narrate-and-emit" interaction) loses its plan on the next
   * turn — it sees only the announcement and has no anchor for what
   * it was about to call tools. The visible symptom: a plan-only turn
   * followed by an unproductive narration loop until the host's
   * planning-nudge budget is exhausted.
   *
   * Mirrors the OpenAI transport's `reasoning_content` round-trip;
   * the wire field name differs but the contract is identical.
   */
  thinking?: string;
  tool_calls?: Array<{
    function: {
      name: string;
      /** Ollama wants an OBJECT here, not a JSON string. */
      arguments: Record<string, unknown>;
    };
  }>;
  /** Echo back the tool's name on `role:'tool'` responses. */
  tool_name?: string;
}

/**
 * Translate the internal (OpenAI-shaped) `ChatMessage` array into the
 * shape Ollama's native `/api/chat` endpoint expects. The two schemas
 * overlap heavily but diverge on three points that will 400 Ollama
 * Cloud:
 *
 *   1. `content` MUST be a string. OpenAI permits `null` for an
 *      assistant turn that emits only `tool_calls`; Ollama rejects
 *      the null with a `json: cannot unmarshal` error.
 *
 *   2. `tool_calls[].function.arguments` is a JSON OBJECT on the
 *      Ollama wire. OpenAI streams arguments as a JSON STRING (which
 *      is what our internal `ChatMessage` persists, because
 *      `consumeChatStream` accumulates raw argument fragments). We
 *      parse the string back into an object here; a parse failure
 *      falls back to `{}` so the turn still round-trips instead of
 *      producing a 400 mid-conversation.
 *
 *   3. Unknown/extra fields — `tool_calls[].id`, `tool_calls[].type`,
 *      `tool_call_id` — are all OpenAI-specific. Strict Ollama Cloud
 *      routes reject them. We emit only the fields Ollama documents.
 *
 *      `reasoning_content` (the OpenAI-side reasoning field) is
 *      translated, NOT stripped: Ollama's documented equivalent is
 *      `message.thinking`, and echoing it back to the wire is what
 *      preserves the model's chain-of-thought across multi-turn
 *      conversations. See `OllamaWireMessage.thinking` for the full
 *      rationale on why this round-trip matters.
 *
 * `role:'tool'` messages map `ChatMessage.name` → `tool_name` which
 * is what Ollama uses to pair the result back to the call; the id
 * used by OpenAI (`tool_call_id`) has no Ollama equivalent.
 */
function toOllamaMessages(messages: readonly ChatMessage[]): OllamaWireMessage[] {
  return messages.map(toOllamaMessage);
}

function toOllamaMessage(m: ChatMessage): OllamaWireMessage {
  const out: OllamaWireMessage = {
    role: m.role,
    content: m.content ?? ''
  };
  if (m.tool_calls && m.tool_calls.length > 0) {
    out.tool_calls = m.tool_calls.map((tc) => ({
      function: {
        name: tc.function.name,
        arguments: parseArgumentsToObject(tc.function.arguments)
      }
    }));
  }
  if (m.role === 'tool' && typeof m.name === 'string' && m.name.length > 0) {
    out.tool_name = m.name;
  }
  // Translate `reasoning_content` → `thinking` on outgoing assistant
  // messages so the model sees its prior chain-of-thought on the next
  // turn. This is the Ollama equivalent of the OpenAI transport's
  // `reasoning_content` round-trip and the canonical field name per
  // the Ollama capabilities/thinking docs. Without this echo, a model
  // that planned in `thinking` and emitted only a one-line content
  // hand-off (e.g. "Now I'll run tools:") cannot recover its plan on
  // the next turn — it loses everything in the reasoning channel and
  // gets stuck in a narration loop. Scoped to `role:'assistant'`
  // because the Ollama schema only documents `thinking` on assistant
  // turns, and we never want to leak prompt-side text through this
  // field.
  if (
    m.role === 'assistant' &&
    typeof m.reasoning_content === 'string' &&
    m.reasoning_content.length > 0
  ) {
    out.thinking = m.reasoning_content;
  }
  return out;
}

/**
 * Defensive JSON.parse for a tool-call arguments string. Returns `{}`
 * for empty / malformed input so a mid-conversation echo of a
 * previous turn never 400s Ollama. An agent model that emits
 * malformed JSON already surfaces the failure through the orchestrator's
 * per-iteration verifier; we don't need to double-fail the retry here.
 *
 * Audit A-19: a malformed-or-non-object payload silently degrades to
 * `{}` on the wire, which the downstream tool executor sees as a
 * "missing <param>" error — a misleading signal for triage because
 * the model's actual emitted JSON was the real fault. We log a warn
 * on every fallback so a developer reading `vyotiq.log` can spot
 * the upstream cause without diffing wire captures. Hot path is
 * the happy `JSON.parse` branch which never logs.
 *
 * Audit fix 2026-05-P2-3: Ollama's tool-call protocol re-emits the
 * SAME arguments JSON on every chunk of a streaming tool call, so a
 * single mid-stream malformed payload would spam `log.warn` once per
 * delta — typically dozens of identical lines per second. We dedup
 * via a tiny hash → lastWarnTs cache: at most one warning per unique
 * preview per `PARSE_WARN_COOLDOWN_MS`. Bounded to `PARSE_WARN_CACHE_MAX`
 * entries so the map can't grow unbounded across long sessions.
 */
const PARSE_WARN_COOLDOWN_MS = 60_000;
const PARSE_WARN_CACHE_MAX = 64;
const parseWarnCache = new Map<string, number>();

function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (((h << 5) + h) ^ s.charCodeAt(i)) | 0;
  }
  return String(h >>> 0);
}

function shouldWarnParseFailure(rawPreview: string, kind: 'parse' | 'shape'): boolean {
  const sig = `${kind}:${djb2(rawPreview)}`;
  const now = Date.now();
  const last = parseWarnCache.get(sig);
  if (last !== undefined && now - last < PARSE_WARN_COOLDOWN_MS) {
    return false;
  }
  // Re-insert (delete+set) so this entry floats to the tail under the
  // insertion-order LRU. Cheap O(1) on Map.
  parseWarnCache.delete(sig);
  parseWarnCache.set(sig, now);
  // Evict the oldest (head) entry once over capacity. `.keys().next()`
  // yields the insertion-order head.
  if (parseWarnCache.size > PARSE_WARN_CACHE_MAX) {
    const oldest = parseWarnCache.keys().next().value;
    if (oldest !== undefined) parseWarnCache.delete(oldest);
  }
  return true;
}

function parseArgumentsToObject(raw: string): Record<string, unknown> {
  if (!raw || raw.trim().length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    const preview = raw.slice(0, 200);
    if (shouldWarnParseFailure(preview, 'shape')) {
      log.warn('tool-call arguments parsed to a non-object; falling back to {}', {
        rawPreview: preview,
        parsedType: parsed === null ? 'null' : Array.isArray(parsed) ? 'array' : typeof parsed
      });
    }
  } catch (err) {
    const preview = raw.slice(0, 200);
    if (shouldWarnParseFailure(preview, 'parse')) {
      log.warn('tool-call arguments JSON.parse failed; falling back to {}', {
        rawPreview: preview,
        err: err instanceof Error ? err.message : String(err)
      });
    }
  }
  return {};
}
