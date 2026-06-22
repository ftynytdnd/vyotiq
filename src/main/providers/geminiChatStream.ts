/**
 * Google Gemini "AI Studio" native streaming chat transport.
 *
 * Targets the documented 2026 endpoint
 * `${baseUrl}/v1beta/models/{modelId}:streamGenerateContent?alt=sse`
 * over POST + Server-Sent Events. The transport is intentionally
 * scoped to the Google AI Studio surface (`generativelanguage.
 * googleapis.com`); Vertex AI's separate auth + endpoint shape is
 * out of scope for this iteration.
 *
 * Why a dedicated transport rather than going through Gemini's
 * OpenAI-compat shim:
 *
 *   - The compat shim does NOT preserve `thoughtSignature` on tool
 *     calls. Gemini 3.x REQUIRES the signature to round-trip on
 *     every subsequent function-call turn or it returns 400 with
 *     "Function call signature missing or invalid". Bypassing the
 *     shim is the only way to keep multi-turn function calling
 *     working on the latest Gemini family.
 *   - The compat shim does NOT expose `usageMetadata.thoughtsTokenCount`
 *     or `cachedContentTokenCount`, so the live context-window pill
 *     would always undercount on a thinking turn.
 *
 * Wire format (verified against `ai.google.dev/api/generate-content`,
 * `ai.google.dev/gemini-api/docs/thought-signatures`, and
 * `ai.google.dev/gemini-api/docs/openai-compat-vs-native` on
 * 2026-05-12):
 *
 *   - The SSE stream emits one frame per partial response; each
 *     frame's `data:` payload is a `GenerateContentResponse` whose
 *     `candidates[0].content.parts` contains zero-or-more `Part`s.
 *   - Text parts: `{ text: "..." }`. May appear interleaved with
 *     thinking parts on the same turn.
 *   - Thinking parts: `{ text: "...", thought: true }`. We surface
 *     these as `reasoningDelta`.
 *   - Function-call parts: `{ functionCall: { name, args },
 *     thoughtSignature?: "..." }`. Gemini sends the FULL function
 *     call in one part (no streaming of args), so we synthesize a
 *     single `toolCallDelta` carrying the complete arguments JSON
 *     plus the thoughtSignature. Live diff UI on Gemini therefore
 *     lands as one full preview frame (auto-expanded rows) rather
 *     than incremental hunks; OpenAI/Anthropic transports stream
 *     tool-arg fragments for frame-by-frame diff growth.
 *   - Final `usageMetadata` is CUMULATIVE per turn (matches
 *     Anthropic's pattern). We REPLACE on each frame; never sum.
 *
 * Auth: `x-goog-api-key: <KEY>` request header. Some self-hosted
 * reverse proxies strip non-allowlisted headers, in which case the
 * caller persists `provider.geminiAuthMode = 'query'` and the
 * `?key=<KEY>` query-string fallback is used. The fallback is
 * decided at provider-add time (the auth probe in `modelDiscovery`
 * detects which mode the upstream accepts).
 */

import type { ChatStreamRequest, ChatStreamDelta } from './chatClient.js';
import type { ChatMessage, TokenUsage } from '@shared/types/chat.js';
import type { ProviderWithKey } from '@shared/types/provider.js';
import { logger } from '../logging/logger.js';
import { classifyProviderError, ProviderError } from './providerError.js';
import { acquire, markRateLimited, markSuccess } from './providerRateGuard.js';
import { createInactivityWatch, isStreamInactivityError } from './streamInactivity.js';
import { readSseFrames, pickSseDataLine } from './sseFrameReader.js';
import { safeText } from './errorBody.js';
import { redactUrlSecrets } from './redactUrlSecrets.js';
import { findProviderModel } from '@shared/providers/modelId.js';
import { modelSupportsImageOutput } from '@shared/providers/visionCapabilities.js';
import { toGeminiUserParts } from './multimodal/userContentWire.js';
import { resolveFileRefsForUserContent } from './files/resolveFileReference.js';
import { recordProviderRateLimits } from './providerRateLimitCapture.js';
import {
  resolveGeminiThinkingConfig,
  resolveStreamerThinkingEffort
} from '@shared/providers/thinkingEffort.js';
import {
  CACHE_LAYER_WORKSPACE_INDEX,
  buildGeminiStaticInstructionTexts,
  extractStaticSystemForWire,
  extractWorkspaceBlock,
  isCacheLayeredTopology
} from '../orchestrator/context/buildContextLayers.js';
import { resolveGeminiExplicitCacheName } from './cacheHints/geminiExplicitCache.js';
import { normalizeWireTools } from './normalizeWireTools.js';

const log = logger.child('providers/chat/gemini');

/**
 * Gemini's `:streamGenerateContent` requires `alt=sse` to upgrade
 * the response from the default JSON-stream-of-arrays encoding to
 * canonical SSE framing. The default encoding is one giant JSON
 * array streamed slowly across the connection — clients have to
 * accumulate the whole thing before parsing, defeating the entire
 * point of streaming. Source: `ai.google.dev/api/rest`.
 */
const SSE_QUERY = 'alt=sse';

/**
 * Gemini structured-blocks wire types — narrow subset we care about.
 * The schema is large; we only annotate what the orchestrator reads.
 */
interface GeminiPartText {
  text?: string;
  /**
   * 2026 thinking parts: `text` carries the chain-of-thought,
   * `thought: true` flags it. We surface as `reasoningDelta` so the
   * existing reasoning UI lights up identically to DeepSeek/Anthropic.
   */
  thought?: boolean;
  /**
   * 2026 thoughtSignature — opaque base64 payload Gemini emits on
   * the same `Part` that closes a thinking segment OR on the
   * matching `functionCall` part. The orchestrator round-trips this
   * back on the next request. Source:
   *   https://ai.google.dev/gemini-api/docs/thought-signatures
   */
  thoughtSignature?: string;
}

interface GeminiPartFunctionCall {
  functionCall?: {
    name?: string;
    args?: Record<string, unknown>;
  };
  thoughtSignature?: string;
}

interface GeminiPartFunctionResponse {
  functionResponse?: {
    name?: string;
    response?: Record<string, unknown>;
  };
}

interface GeminiPartInlineData {
  inlineData?: { mimeType: string; data: string };
}

type GeminiPart = GeminiPartText &
  GeminiPartFunctionCall &
  GeminiPartFunctionResponse &
  GeminiPartInlineData;

interface GeminiCandidate {
  content?: { role?: string; parts?: GeminiPart[] };
  finishReason?: string;
  index?: number;
}

interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  /**
   * 2026 — thinking tokens for the turn. `thoughtsTokenCount` is the
   * official field name (NOT `reasoningTokenCount` — that's the
   * OpenAI/xAI variant). Cumulative per turn.
   */
  thoughtsTokenCount?: number;
  /**
   * 2026 — implicit and explicit cache reads. `cachedContentTokenCount`
   * is the official top-level field for explicit context caching;
   * implicit cache hits surface inside `promptTokensDetails`.
   * Verified May 2026 against `ai.google.dev/gemini-api/docs/caching`.
   */
  cachedContentTokenCount?: number;
  promptTokensDetails?: {
    cachedContentTokenCount?: number;
  };
}

interface GeminiStreamFrame {
  candidates?: GeminiCandidate[];
  usageMetadata?: GeminiUsageMetadata;
  /** Top-level error block when a single SSE frame carries a fatal. */
  error?: { code?: number; message?: string; status?: string };
  /** Top-level `promptFeedback` flag — surfaces safety blocks before any candidates exist. */
  promptFeedback?: { blockReason?: string };
}

/**
 * Async-generator yielding `ChatStreamDelta`s in the canonical
 * dialect-agnostic shape. Surface is identical to `streamOpenAi` /
 * `streamOllama` / `streamAnthropic` so callers can treat them
 * interchangeably.
 */
export async function* streamGemini(
  req: ChatStreamRequest,
  provider: ProviderWithKey
): AsyncGenerator<ChatStreamDelta> {
  // Translate the OpenAI-canonical `messages` array into Gemini's
  // structured-blocks wire format. `systemInstruction` is hoisted
  // out of the contents list (Gemini puts it at the top level) and
  // every assistant tool_call becomes a `functionCall` part, every
  // tool message becomes a `functionResponse` part on a `user`-role
  // turn (Gemini doesn't have a dedicated tool role).
  const translated = await toGeminiContents(req.messages, provider);
  const wireTools = normalizeWireTools(req.tools);

  const body: Record<string, unknown> = { contents: translated.contents };
  const staticParts = buildGeminiStaticInstructionTexts(req.messages);
  const staticSystemOnly = extractStaticSystemForWire(req.messages);
  const workspaceBlock = extractWorkspaceBlock(req.messages);
  let explicitCacheName: string | undefined;
  if (staticParts.length > 0 && provider.apiKey) {
    explicitCacheName = await resolveGeminiExplicitCacheName({
      providerId: req.providerId,
      model: req.model,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      geminiAuthMode: provider.geminiAuthMode,
      staticSystem: staticSystemOnly,
      workspaceBlock,
      tools: wireTools,
      signal: req.signal
    });
  }
  if (explicitCacheName) {
    body['cachedContent'] = explicitCacheName;
  } else if (staticParts.length > 0) {
    body['systemInstruction'] = {
      parts: staticParts.map((text) => ({ text }))
    };
  } else if (translated.systemInstruction !== null) {
    body['systemInstruction'] = translated.systemInstruction;
  }
  if (!explicitCacheName && wireTools && wireTools.length > 0) {
    body['tools'] = [
      {
        functionDeclarations: wireTools.map((t) => ({
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters
        }))
      }
    ];
    // Map OpenAI-style `tool_choice` onto Gemini's
    // `toolConfig.functionCallingConfig.mode`:
    //   - 'auto'      → AUTO   (default; we still send it explicitly
    //                            so a downstream proxy can't accidentally
    //                            change the default)
    //   - 'required'  → ANY    (force at least one function call)
    //   - 'none'      → NONE   (force a text reply even if tools exist)
    let mode: 'AUTO' | 'ANY' | 'NONE' = 'AUTO';
    if (req.toolChoice === 'required') mode = 'ANY';
    else if (req.toolChoice === 'none') mode = 'NONE';
    body['toolConfig'] = { functionCallingConfig: { mode } };
  }
  // `generationConfig` carries temperature / maxOutputTokens / etc.
  // Gemini's field names diverge from OpenAI's so the canonical
  // request fields must be remapped here.
  const generationConfig: Record<string, unknown> = {};
  if (typeof req.temperature === 'number') generationConfig['temperature'] = req.temperature;
  if (typeof req.maxTokens === 'number') generationConfig['maxOutputTokens'] = req.maxTokens;
  // Thinking-effort (2026). Gemini 3.x uses `thinkingConfig.thinkingLevel`;
  // legacy 2.5 uses an integer `thinkingBudget` (0 disables).
  const geminiEffort = resolveStreamerThinkingEffort(provider, req.model, req.reasoningEffort);
  const thinkingConfig = resolveGeminiThinkingConfig(
    geminiEffort,
    findProviderModel(provider, req.model)?.thinking
  );
  if (thinkingConfig !== null) generationConfig['thinkingConfig'] = thinkingConfig;
  const modelInfo = findProviderModel(provider, req.model);
  if (modelSupportsImageOutput(req.model, modelInfo)) {
    generationConfig['responseModalities'] = ['TEXT', 'IMAGE'];
  }
  if (Object.keys(generationConfig).length > 0) {
    body['generationConfig'] = generationConfig;
  }

  // Build the request URL. The model id goes IN the path
  // (`:streamGenerateContent`) AND the query carries `alt=sse` so
  // the response is canonical SSE rather than the slow
  // JSON-array-stream default.
  //
  // `provider.geminiAuthMode === 'query'` falls back to passing the
  // key on the query string when a self-hosted proxy strips
  // non-allowlisted headers. Header form is preferred.
  const queryParts: string[] = [SSE_QUERY];
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream'
  };
  if (provider.apiKey) {
    if (provider.geminiAuthMode === 'query') {
      queryParts.push(`key=${encodeURIComponent(provider.apiKey)}`);
    } else {
      headers['x-goog-api-key'] = provider.apiKey;
    }
  }
  const url = `${provider.baseUrl}/v1beta/models/${encodeURIComponent(req.model)}:streamGenerateContent?${queryParts.join('&')}`;

  const watch = createInactivityWatch(req.signal ? { parent: req.signal } : {});
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
      log.warn('provider stream inactive before headers', {
        url: redactUrlSecrets(url),
        providerId: req.providerId
      });
    }
    throw err;
  }

  recordProviderRateLimits(req.providerId, res.headers);

  if (!res.ok || !res.body) {
    watch.dispose();
    const errBody = res.body ? await safeText(res) : '';
    log.warn('streamGenerateContent request failed', {
      status: res.status,
      statusText: res.statusText,
      url: redactUrlSecrets(url),
      bodyPreview: errBody.slice(0, 200)
    });
    if (res.status === 429 || res.status >= 500) markRateLimited(req.providerId);
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

  markSuccess(req.providerId);

  if (req.onConnect) {
    try {
      req.onConnect();
    } catch (err) {
      log.warn('onConnect listener threw; continuing to read stream', { err });
    }
  }

  // Per-turn state. Tool-call ids are minted client-side because
  // Gemini's `functionCall` part DOES NOT carry a stable id (the
  // wire shape is `{name, args}` only). The orchestrator's tool-
  // call accumulator keys on `id`, so we synthesize one per
  // call: `gem_<turn>_<index>`.
  let toolCallCounter = 0;
  let cumUsage: GeminiUsageMetadata | null = null;

  /**
   * Process one SSE frame body. Yields zero-or-more `ChatStreamDelta`s.
   * Returns `true` when a fatal error frame closes the stream early.
   */
  function* processFrame(frame: string): Generator<ChatStreamDelta, boolean> {
    const payload = pickSseDataLine(frame);
    if (payload === null) return false;
    let chunk: GeminiStreamFrame;
    try {
      chunk = JSON.parse(payload) as GeminiStreamFrame;
    } catch {
      log.warn('failed to parse SSE payload; skipping frame', {
        preview: payload.slice(0, 200)
      });
      return false;
    }

    // Top-level error frame: surface as ProviderError, terminate.
    if (chunk.error) {
      const status = typeof chunk.error.code === 'number' ? chunk.error.code : 0;
      const message = chunk.error.message ?? 'Unknown Gemini error';
      const rateLimited = status === 429 || (status >= 500 && status < 600);
      if (rateLimited) markRateLimited(req.providerId);
      throw new ProviderError({
        status,
        kind: rateLimited ? 'rate-limit' : 'server',
        providerId: req.providerId,
        providerName: provider.name,
        friendlyMessage: `${provider.name}: ${message}`,
        surface: 'chat',
        rawBody: payload.slice(0, 1000)
      });
    }

    // Safety block before any candidates: surface as a stop with
    // an explicit reason so the orchestrator can show a friendly
    // "request was blocked" message rather than a hung run.
    if (chunk.promptFeedback?.blockReason) {
      const reason = chunk.promptFeedback.blockReason;
      yield { contentDelta: `\n[Gemini safety: ${reason}]\n` };
      yield { finishReason: 'safety' };
      return true;
    }

    // Cumulative usage — REPLACE, never sum (matches Anthropic's
    // pattern; mirroring is critical so cached + thinking token
    // counts don't double).
    if (chunk.usageMetadata) {
      cumUsage = chunk.usageMetadata;
      yield { usage: toCanonicalUsage(cumUsage) };
    }

    // Walk every candidate. Gemini's API supports `candidateCount > 1`
    // but we always request one in our `generationConfig` path; we
    // still iterate defensively in case a future request shape opts
    // into multiple. Only the first candidate's parts feed the
    // orchestrator (the renderer doesn't model multi-candidate yet).
    const cand = chunk.candidates?.[0];
    if (!cand) return false;
    const parts = cand.content?.parts ?? [];
    for (const part of parts) {
      // 1. Function-call part — synthesize a fully-formed
      //    `toolCallDelta`. Gemini sends the entire call in one
      //    chunk, so we mint a synthetic id, emit the name + the
      //    full JSON-encoded arguments, and forward the
      //    `thoughtSignature` for the round-trip plumbing.
      if (part.functionCall && typeof part.functionCall.name === 'string') {
        const idx = toolCallCounter;
        toolCallCounter += 1;
        const id = `gem_${idx}`;
        const argsObj = part.functionCall.args ?? {};
        const toolCallDelta: ChatStreamDelta['toolCallDelta'] = {
          index: idx,
          id,
          name: part.functionCall.name,
          argumentsDelta: JSON.stringify(argsObj)
        };
        if (typeof part.thoughtSignature === 'string' && part.thoughtSignature.length > 0) {
          toolCallDelta.thoughtSignature = part.thoughtSignature;
        }
        yield { toolCallDelta };
        continue;
      }
      // 2. Thinking text part — surface as reasoning delta.
      //    Gemini's thinking text and the matching `thoughtSignature`
      //    can land on separate parts; we emit the reasoning text
      //    when present and let the consume layer pair the
      //    signature with the closing block.
      if (part.thought === true && typeof part.text === 'string' && part.text.length > 0) {
        yield { reasoningDelta: part.text };
        continue;
      }
      // 3. Plain text part.
      if (typeof part.text === 'string' && part.text.length > 0) {
        yield { contentDelta: part.text };
        continue;
      }
      // 4. Generated image part (when responseModalities includes IMAGE).
      if (
        part.inlineData &&
        typeof part.inlineData.mimeType === 'string' &&
        part.inlineData.mimeType.startsWith('image/') &&
        typeof part.inlineData.data === 'string' &&
        part.inlineData.data.length > 0
      ) {
        yield {
          imageDelta: {
            mime: part.inlineData.mimeType,
            base64: part.inlineData.data
          }
        };
        continue;
      }
    }

    if (cand.finishReason) {
      yield { finishReason: mapFinishReason(cand.finishReason) };
    }
    return false;
  }

  try {
    for await (const frame of readSseFrames({
      body: res.body,
      watch,
      onInactivity: () => {
        log.warn('provider stream inactive mid-read', {
          url: redactUrlSecrets(url),
          providerId: req.providerId
        });
      }
    })) {
      const gen = processFrame(frame);
      let r = gen.next();
      while (!r.done) {
        yield r.value;
        r = gen.next();
      }
      if (r.value === true) return;
    }
  } finally {
    watch.dispose();
  }
}

/**
 * Map Gemini's `finishReason` enum onto the orchestrator's canonical
 * shape. Gemini's set is larger than OpenAI's; we collapse the
 * "abnormal termination" tail into `'error'` because the orchestrator's
 * resume/retry policy is the same regardless of the exact failure
 * mode.
 *
 * Source: `ai.google.dev/api/generate-content#FinishReason` (May 2026).
 */
function mapFinishReason(reason: string): string {
  switch (reason) {
    case 'STOP':
      return 'stop';
    case 'MAX_TOKENS':
      return 'length';
    // The model emitted a `functionCall` part; orchestrator routes
    // the resulting tool-call accumulator to its executor.
    case 'TOOL_USE':
      return 'tool_calls';
    case 'SAFETY':
    case 'PROHIBITED_CONTENT':
    case 'BLOCKLIST':
    case 'SPII':
    case 'IMAGE_SAFETY':
      return 'safety';
    case 'MALFORMED_FUNCTION_CALL':
      // The model emitted a function call whose args don't validate
      // against the declared schema. Orchestrator's tool runner
      // already shows a dedicated "tool-call args invalid" error
      // when it tries to execute, but flagging this at the
      // finishReason level lets the renderer skip the executor
      // entirely on the next iteration and prompt the model to
      // retry with corrected args.
      return 'tool_calls';
    case 'RECITATION':
    case 'LANGUAGE':
    case 'OTHER':
    case 'UNEXPECTED_TOOL_CALL':
    default:
      return reason.toLowerCase();
  }
}

/**
 * Convert Gemini's `usageMetadata` into the canonical camelCase
 * `TokenUsage`. Field mapping:
 *
 *   - `promptTokenCount`        → `promptTokens`
 *   - `candidatesTokenCount`    → `completionTokens`
 *   - `totalTokenCount`         → `totalTokens`
 *   - `thoughtsTokenCount`      → `reasoningTokens` (Gemini-specific name)
 *   - `cachedContentTokenCount` → `cachedPromptTokens`
 *
 * Note that Gemini does NOT report a separate cache-creation token
 * count (caching is implicit + explicit context caching, both of
 * which are billed as input tokens), so `cacheCreationTokens` is
 * always omitted on this dialect.
 */
function toCanonicalUsage(u: GeminiUsageMetadata): TokenUsage {
  const prompt = typeof u.promptTokenCount === 'number' ? u.promptTokenCount : 0;
  const completion = typeof u.candidatesTokenCount === 'number' ? u.candidatesTokenCount : 0;
  const total = typeof u.totalTokenCount === 'number' ? u.totalTokenCount : prompt + completion;
  const out: TokenUsage = {
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: total
  };
  if (typeof u.thoughtsTokenCount === 'number') out.reasoningTokens = u.thoughtsTokenCount;
  const cachedExplicit =
    typeof u.cachedContentTokenCount === 'number' ? u.cachedContentTokenCount : 0;
  const cachedImplicit =
    typeof u.promptTokensDetails?.cachedContentTokenCount === 'number'
      ? u.promptTokensDetails.cachedContentTokenCount
      : 0;
  const cached = Math.max(cachedExplicit, cachedImplicit);
  if (cached > 0) out.cachedPromptTokens = cached;
  return out;
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

/**
 * Translate the OpenAI-canonical `messages` array into Gemini's
 * `{ contents, systemInstruction }` shape.
 *
 *   - `system` messages → hoisted into a single `systemInstruction`
 *     with `parts: [{text}]`. Multiple system messages join with a
 *     blank line, mirroring the Anthropic translator's behavior.
 *   - `user` messages → `{ role: 'user', parts: [{text}] }`.
 *   - `assistant` messages → `{ role: 'model', parts }` where parts
 *     can include a leading `{text}` for content, a `{thought:true,
 *     text}` block for replayed reasoning, and one `{functionCall}`
 *     part per persisted tool_call. The orchestrator persists
 *     `ToolCall.thoughtSignature`; we copy it back onto the
 *     matching `functionCall` part so Gemini 3.x's signature-bound
 *     plan-continuity check passes.
 *   - `tool` messages → `{ role: 'user', parts: [{functionResponse}] }`.
 *     Gemini doesn't have a dedicated tool role — function results
 *     are delivered as a follow-up user turn.
 *
 * Skips empty assistant turns (Gemini rejects them, same as Anthropic).
 *
 * Pure / synchronous; exported as a test-only internal below.
 */
async function toGeminiContents(
  messages: readonly ChatMessage[],
  provider: ProviderWithKey
): Promise<{
  systemInstruction: { parts: GeminiPart[] } | null;
  contents: GeminiContent[];
}> {
  const layered = isCacheLayeredTopology(messages);
  const systemParts: string[] = [];
  const contents: GeminiContent[] = [];

  for (let i = 0; i < messages.length; i++) {
    if (layered && i <= CACHE_LAYER_WORKSPACE_INDEX) continue;
    const m = messages[i]!;
    if (m.role === 'system') {
      const c = m.content;
      if (typeof c === 'string' && c.length > 0) systemParts.push(c);
      continue;
    }
    if (m.role === 'tool') {
      // Gemini's function-result shape: a `user` turn with a
      // `functionResponse` part. The `name` MUST match the
      // `functionCall.name` from the matching assistant turn so
      // Gemini can route the response to the correct call slot.
      let parsed: Record<string, unknown> = {};
      try {
        const raw = JSON.parse(typeof m.content === 'string' ? m.content : '{}') as unknown;
        if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
          parsed = raw as Record<string, unknown>;
        } else {
          parsed = { result: raw };
        }
      } catch {
        // Tool output isn't valid JSON (the orchestrator's tool
        // runner returns plain strings for many tools). Wrap into
        // a `{ result: "..." }` envelope so the function-response
        // shape stays well-formed.
        parsed = { result: typeof m.content === 'string' ? m.content : '' };
      }
      const name = m.name ?? 'unknown';
      contents.push({
        role: 'user',
        parts: [{ functionResponse: { name, response: parsed } }]
      });
      continue;
    }
    if (m.role === 'user') {
      const fileRefs = await resolveFileRefsForUserContent(provider, m.content);
      contents.push({ role: 'user', parts: toGeminiUserParts(m.content, fileRefs) });
      continue;
    }
    // assistant
    const parts: GeminiPart[] = [];
    if (typeof m.content === 'string' && m.content.length > 0) {
      parts.push({ text: m.content });
    }
    if (m.tool_calls && m.tool_calls.length > 0) {
      // Look up the persisted tool-call records (if any) so we can
      // round-trip `thoughtSignature` per call. The persisted
      // shape is `ChatMessage.tool_calls[i]` which carries
      // `function.name` + `function.arguments`, AND optionally a
      // sibling `ToolCall` accumulator entry on the conversation
      // store with `thoughtSignature`. The accumulator isn't on
      // the message itself — the orchestrator threads
      // `thoughtSignature` via the message-side
      // `tool_calls[i].function` extension when persisting the
      // assistant turn (see `runLoop.ts`). For now we look for
      // the optional field on the function payload directly.
      for (const tc of m.tool_calls) {
        let argsObj: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(tc.function.arguments || '{}') as unknown;
          if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
            argsObj = parsed as Record<string, unknown>;
          }
        } catch {
          // Malformed args — fall back to {} so the turn still
          // round-trips. The same downstream tool error will
          // surface when Gemini rejects the call.
        }
        const part: GeminiPart = {
          functionCall: { name: tc.function.name, args: argsObj }
        };
        // Phase 9 (2026): the orchestrator stores `thoughtSignature`
        // on the persisted ToolCall record alongside the function
        // payload. When present, we copy it onto the matching
        // `functionCall` part so Gemini's plan-continuity check
        // accepts the request.
        const sig = (tc as { thoughtSignature?: string }).thoughtSignature;
        if (typeof sig === 'string' && sig.length > 0) {
          part.thoughtSignature = sig;
        }
        parts.push(part);
      }
    }
    if (parts.length === 0) continue;
    contents.push({ role: 'model', parts });
  }

  const systemInstruction =
    systemParts.length > 0
      ? { parts: [{ text: systemParts.join('\n\n') }] as GeminiPart[] }
      : null;
  return { systemInstruction, contents };
}


/** Test-only export — surfaces the body translator + finishReason
 *  mapper + usage normalizer so tests can lock in the exact wire
 *  shape without spinning up a mock fetch + SSE stream. */
export const __geminiInternals = {
  toGeminiContents,
  mapFinishReason,
  toCanonicalUsage
};

