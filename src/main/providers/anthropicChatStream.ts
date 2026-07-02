/**
 * Anthropic native streaming chat transport (Phase 8 — 2026).
 *
 * POSTs to `${baseUrl}/v1/messages` with `stream: true` and parses
 * the dialect's SSE event stream into the same `ChatStreamDelta`
 * shape every other transport emits, so the orchestrator loop
 * (`runLoop` / `consumeChatStream`) never branches on dialect.
 *
 * Wire spec (verified 2026):
 *
 *   - Endpoint: `POST {baseUrl}/v1/messages`
 *   - Required headers:
 *       `x-api-key:        <apiKey>`
 *       `anthropic-version: 2023-06-01`
 *       `Accept:           text/event-stream`
 *       `Content-Type:     application/json`
 *     Optional:
 *       `anthropic-beta:   <comma-joined betas>` (Phase 10 opt-in)
 *   - SSE event types we consume:
 *       message_start          – initial usage seed
 *       content_block_start    – opens a block (text / thinking /
 *                                  tool_use / server_tool_use /
 *                                  web_search_tool_result / compaction)
 *       content_block_delta    – streaming chunks; sub-types:
 *                                  text_delta, thinking_delta,
 *                                  signature_delta (thinking signature
 *                                  bytes — must round-trip),
 *                                  input_json_delta (tool args)
 *       content_block_stop
 *       message_delta          – CUMULATIVE usage + stop_reason
 *       message_stop
 *       ping                   – keep-alive; ignore but reset watchdog
 *       error                  – mid-stream provider error envelope
 *
 * 🔴 CRITICAL TRAP — `message_delta.usage` is CUMULATIVE, not a delta.
 *    Both `message_start.usage` and `message_delta.usage` carry the
 *    same `cache_creation_input_tokens` / `cache_read_input_tokens`.
 *    Adding them double-counts. We track the latest cumulative
 *    snapshot per stream and yield REPLACE-style frames; the reducer
 *    side's existing `foldTokenUsage` then merges normally.
 *    Sources:
 *      - https://platform.claude.com/docs/en/build-with-claude/streaming
 *      - Anthropic SDK type comment: "The cumulative number of input
 *        tokens used to create the cache entry."
 *      - LangChain.js bug (March 2026):
 *        https://github.com/langchain-ai/langchainjs/issues/10249
 *
 * 2026 stop reasons handled:
 *    end_turn                       → 'stop'
 *    max_tokens                     → 'length'
 *    tool_use                       → 'tool_calls'
 *    pause_turn                     → 'pause'    (server tool paused;
 *                                                 orchestrator resumes)
 *    stop_sequence                  → 'stop'
 *    model_context_window_exceeded  → 'length'   (opt-in beta)
 *
 * This file is called only through `chatClient.streamChat()` — it
 * should NOT be imported directly from anywhere else in the codebase
 * so the dialect-routing policy stays in one place.
 */

import { randomUUID } from 'node:crypto';
import type { ChatStreamRequest, ChatStreamDelta } from './chatClient.js';
import type { ChatMessage, TokenUsage } from '@shared/types/chat.js';
import type { ProviderWithKey } from '@shared/types/provider.js';
import { logger } from '../logging/logger.js';
import { classifyProviderError, ProviderError } from './providerError.js';
import { acquire, markRateLimited, markSuccess } from './providerRateGuard.js';
import { recordProviderRateLimits } from './providerRateLimitCapture.js';
import { createInactivityWatch, isStreamInactivityError } from './streamInactivity.js';
import { readSseFrames } from './sseFrameReader.js';
import { safeText } from './errorBody.js';
import { findProviderModel } from '@shared/providers/modelId.js';
import { toAnthropicUserBlocks, userContentHasAudioParts } from './multimodal/userContentWire.js';
import { resolveFileRefsForUserContent } from './files/resolveFileReference.js';
import {
  anthropicBetasForProvider,
  mapAnthropicThinking,
  resolveStreamerThinkingEffort
} from '@shared/providers/thinkingEffort.js';
import {
  CLAUDE_CODE_PROXY_STREAM_INACTIVITY_MS,
  claudeCodeProxyModelSupportsAnthropicBetas,
  claudeCodeProxySkipsThinkingEffort,
  isClaudeCodeProxyProvider,
  resolveClaudeCodeProxyModelId
} from '@shared/providers/claudeCodeProxy.js';
import {
  PRE_HEADER_STREAM_INACTIVITY_MS,
  STREAM_INACTIVITY_TIMEOUT_MS
} from '@shared/constants.js';
import {
  applyAnthropicAutomaticCache,
  buildAnthropicSystemBlocks,
  markAnthropicToolCache,
  markWorkspaceUserCache
} from './cacheHints/anthropicCacheHints.js';
import {
  ANTHROPIC_CACHE_DIAGNOSIS_BETA,
  isAnthropicCacheDiagnosticsEnabled,
  parseAnthropicCacheDiagnostics
} from './cacheHints/anthropicCacheDiagnostics.js';
import { ANTHROPIC_COMPACTION_BETA, ANTHROPIC_CONTEXT_MANAGEMENT_BETA } from './capabilities.js';
import { normalizeWireTools } from './normalizeWireTools.js';
import { extractStaticSystemForWire } from '../orchestrator/context/buildContextLayers.js';
import { fetchClaudeCodeProxyStatusJson } from './claudeCodeProxy.js';

const log = logger.child('providers/chat/anthropic');

/**
 * Default output ceiling when the caller doesn't pin `maxTokens`.
 * Anthropic REQUIRES `max_tokens` on `/v1/messages` (unlike OpenAI
 * which defaults to "until end-of-output"), so we always send a
 * value. 4096 is large enough for orchestrator turns but small
 * enough to avoid runaway billing on a buggy model. The user can
 * override via `req.maxTokens`.
 */
const DEFAULT_MAX_TOKENS = 4096;

/** Raw cumulative-usage snapshot — assembled from `message_start` +
 *  every subsequent `message_delta` so we can emit REPLACE-style
 *  ChatStreamDelta.usage frames. */
interface CumulativeUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

/**
 * Open content blocks we track per index. The wire sends
 * `content_block_start { index }` and then a series of
 * `content_block_delta { index, delta: {…} }` updates. We map each
 * index → its type so the delta router can pick the right
 * `ChatStreamDelta` channel.
 *
 * `tool_use` blocks also carry their `id` + `name` so we can mint
 * the matching `toolCallDelta` frames as JSON-arguments stream in.
 */
type OpenBlockType = 'text' | 'thinking' | 'tool_use' | 'image' | 'other';

interface OpenBlock {
  type: OpenBlockType;
  /** Tool-call id (only set when type === 'tool_use'). */
  toolUseId?: string;
  /** Tool name (only set when type === 'tool_use'). */
  toolName?: string;
  /**
   * Phase 8 (2026): per-thinking-block signature accumulator. Anthropic
   * delivers the encrypted signature inside one or more
   * `signature_delta` SSE events that arrive AFTER the closing
   * `thinking_delta` for the same block, but BEFORE the matching
   * `content_block_stop`. We accumulate here and emit a single
   * `reasoningSignature` ChatStreamDelta on `content_block_stop` so
   * the consumer sees one terminal signature per block — matching the
   * "concatenate-on-arrival" contract the consume layer expects.
   */
  signatureBuf?: string;
}

/**
 * Async-generator that yields deltas as they arrive. Surface is
 * identical to `streamOpenAi` / `streamOllama` so callers can treat
 * them interchangeably.
 */
export async function* streamAnthropic(
  req: ChatStreamRequest,
  provider: ProviderWithKey
): AsyncGenerator<ChatStreamDelta> {
  const url = `${provider.baseUrl}/v1/messages`;

  // Translate our internal OpenAI-shaped messages into Anthropic's
  // structured-blocks wire format. The `system` field is hoisted out
  // of the messages list (Anthropic puts it at the top level, not in
  // the array) and every assistant `tool_calls` becomes a `tool_use`
  // content block.
  const translated = await toAnthropicMessages(req.messages, provider);
  const proxyRoute = isClaudeCodeProxyProvider(provider);
  let wireModel = req.model;
  if (proxyRoute) {
    if (req.model.trim().endsWith(':auto')) {
      const status = await fetchClaudeCodeProxyStatusJson();
      const defaultModel =
        status?.config?.userEnvModel ?? status?.config?.settingsModel ?? undefined;
      wireModel = resolveClaudeCodeProxyModelId(req.model, defaultModel);
      if (wireModel !== req.model) {
        log.info('resolved proxy auto model', { from: req.model, to: wireModel });
      }
    } else {
      wireModel = resolveClaudeCodeProxyModelId(req.model);
    }
  }
  const anthropicCacheEnabled =
    !proxyRoute || claudeCodeProxyModelSupportsAnthropicBetas(wireModel);
  const body: Record<string, unknown> = {
    model: wireModel,
    max_tokens: typeof req.maxTokens === 'number' ? req.maxTokens : DEFAULT_MAX_TOKENS,
    messages: translated.messages,
    stream: true
  };
  if (proxyRoute && !anthropicCacheEnabled) {
    const staticText = extractStaticSystemForWire(req.messages) || translated.system;
    if (staticText.trim()) {
      body['system'] = [{ type: 'text', text: staticText }];
    }
  } else {
    const systemBlocks = buildAnthropicSystemBlocks(req.messages, translated.system);
    if (systemBlocks.length > 0) body['system'] = systemBlocks;
  }
  const wireMessages = translated.messages as unknown as Array<{
    role: string;
    content: Array<Record<string, unknown>>;
  }>;
  if (anthropicCacheEnabled) {
    markWorkspaceUserCache(wireMessages, req.messages);
    applyAnthropicAutomaticCache(body);
  }
  if (req.workspaceId?.trim()) {
    body['metadata'] = { user_id: req.workspaceId.trim() };
  }
  const cacheDiagnosticsOn = isAnthropicCacheDiagnosticsEnabled();
  if (cacheDiagnosticsOn && anthropicCacheEnabled) {
    body['diagnostics'] = {
      previous_message_id: req.previousAnthropicMessageId ?? null
    };
  }
  if (typeof req.temperature === 'number') body['temperature'] = req.temperature;
  const wireTools = normalizeWireTools(req.tools);
  if (wireTools && wireTools.length > 0) {
    const tools = wireTools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters
    }));
    if (anthropicCacheEnabled) markAnthropicToolCache(tools);
    body['tools'] = tools;
    // OpenAI-shape `tool_choice` → Anthropic's structured form.
    if (req.toolChoice === 'auto') body['tool_choice'] = { type: 'auto' };
    else if (req.toolChoice === 'required') body['tool_choice'] = { type: 'any' };
    // `'none'` ⇒ leave the field unset; Anthropic defaults to no
    // forced tool use, same as `auto` without `tools` present.
    if (req.parallelToolCalls === true) {
      body['disable_parallel_tool_use'] = false;
    }
  }
  // Phase 8 (2026): inject `thinking` config when the user opted into
  // extended thinking AND the model supports it. The two modes follow
  // Anthropic's 2026 documentation (verified May 2026):
  //
  //   - `{ type: 'adaptive' }`  — Opus 4.7 / 4.6, Sonnet 4.6, Mythos
  //                                Preview. Manual `enabled` returns 400
  //                                on Opus 4.7 specifically; on the
  //                                other adaptive-tier models it still
  //                                works but is deprecated.
  //   - `{ type: 'enabled', budget_tokens }` — Older thinking-capable
  //                                models (Sonnet 4.5 and earlier,
  //                                Sonnet 4, Opus 4, Haiku 4.5).
  //                                `budget_tokens` derives from
  //                                `effort` (low ≈ 2048, medium ≈ 8192,
  //                                high ≈ 16384) and must be < max_tokens.
  //
  // Non-thinking models (legacy Haiku 3, etc.) silently drop the field
  // when we omit it. The shared resolver reads the per-model
  // `modelThinking` override (falling back to the legacy provider-wide
  // `anthropicThinking`) and maps it to the 2026 wire shape: adaptive
  // models get `{ type: 'adaptive' }` + an `output_config.effort`
  // guide; older models get a derived `budget_tokens`.
  const anthroEffort =
    proxyRoute && claudeCodeProxySkipsThinkingEffort()
      ? undefined
      : resolveStreamerThinkingEffort(provider, req.model, req.reasoningEffort);
  const thinking =
    proxyRoute && claudeCodeProxySkipsThinkingEffort()
      ? null
      : mapAnthropicThinking(
          anthroEffort,
          body['max_tokens'] as number,
          DEFAULT_MAX_TOKENS,
          findProviderModel(provider, wireModel)?.thinking
        );
  if (thinking !== null) {
    body['thinking'] = thinking.config;
    if (thinking.effortField !== undefined) {
      body['output_config'] = { effort: thinking.effortField };
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    'x-api-key': provider.apiKey,
    'anthropic-version': '2023-06-01'
  };
  const supportsAnthropicBetas = anthropicCacheEnabled;
  const betas = new Set(
    supportsAnthropicBetas ? (anthropicBetasForProvider(provider.anthropicBetas) ?? []) : []
  );
  if (cacheDiagnosticsOn && supportsAnthropicBetas) betas.add(ANTHROPIC_CACHE_DIAGNOSIS_BETA);

  // Opportunistic native context editing (server-side tool-result clearing).
  // Backstop ON TOP of the host-side reversible reduction: keeps the most
  // recent tool results and lets the server drop older ones once the prompt
  // crosses the trigger. Only attached when the orchestrator opted in.
  const ctxEdit = supportsAnthropicBetas ? req.anthropicContextEditing : undefined;
  if (ctxEdit && ctxEdit.triggerInputTokens > 0) {
    betas.add(ANTHROPIC_CONTEXT_MANAGEMENT_BETA);
    const clearEdit: Record<string, unknown> = {
      type: 'clear_tool_uses_20250919',
      trigger: { type: 'input_tokens', value: ctxEdit.triggerInputTokens },
      keep: { type: 'tool_uses', value: Math.max(0, ctxEdit.keepToolUses) }
    };
    if (typeof ctxEdit.clearAtLeastTokens === 'number' && ctxEdit.clearAtLeastTokens > 0) {
      clearEdit['clear_at_least'] = { type: 'input_tokens', value: ctxEdit.clearAtLeastTokens };
    }
    if (ctxEdit.clearToolInputs === true) {
      clearEdit['clear_tool_inputs'] = true;
    }
    if (ctxEdit.excludeTools && ctxEdit.excludeTools.length > 0) {
      clearEdit['exclude_tools'] = [...ctxEdit.excludeTools];
    }
    const edits: Array<Record<string, unknown>> = [clearEdit];
    // Opt-in server-side compaction backstop (`compact_20260112`). Stateless
    // from our side: we keep sending full host-managed history and the server
    // re-summarizes earlier turns before the model sees them. Requires its own
    // beta header and a trigger ≥ 50k tokens.
    if (ctxEdit.serverCompaction && ctxEdit.serverCompaction.triggerTokens >= 50_000) {
      betas.add(ANTHROPIC_COMPACTION_BETA);
      edits.push({
        type: 'compact_20260112',
        trigger: { type: 'input_tokens', value: ctxEdit.serverCompaction.triggerTokens }
      });
    }
    body['context_management'] = { edits };
  }

  if (betas.size > 0) {
    headers['anthropic-beta'] = [...betas].join(',');
  }

  // Inactivity watchdog — wraps the caller's signal so a silent SSE
  // connection can't hang the run forever. Mirrors the OpenAI /
  // Ollama transports' pattern; see `streamInactivity.ts` for the
  // rationale. Proxy providers get a longer mid-stream budget because
  // Composer/Codex can think silently for minutes without SSE bytes.
  const streamInactivityMs = isClaudeCodeProxyProvider(provider)
    ? CLAUDE_CODE_PROXY_STREAM_INACTIVITY_MS
    : STREAM_INACTIVITY_TIMEOUT_MS;
  const watch = createInactivityWatch(
    req.signal
      ? { parent: req.signal, timeoutMs: PRE_HEADER_STREAM_INACTIVITY_MS }
      : { timeoutMs: PRE_HEADER_STREAM_INACTIVITY_MS }
  );

  // Adaptive rate guard — same shared cooldown as the other
  // transports. A sibling worker just got 429? Sleep until the
  // cooldown lifts before we pile on.
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
        url,
        providerId: req.providerId
      });
    }
    throw err;
  }

  recordProviderRateLimits(req.providerId, res.headers);

  if (!res.ok || !res.body) {
    watch.dispose();
    const errBody = res.body ? await safeText(res) : '';
    log.warn('messages request failed', {
      status: res.status,
      statusText: res.statusText,
      url,
      bodyPreview: errBody.slice(0, 300)
    });
    if (res.status === 429 || res.status >= 500) {
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

  markSuccess(req.providerId);

  if (req.onConnect) {
    try {
      req.onConnect();
    } catch (err) {
      log.warn('onConnect listener threw; continuing to read stream', { err });
    }
  }
  watch.setTimeoutMs(streamInactivityMs);

  // Anthropic SSE frames carry an explicit `event: <name>` line
  // alongside `data: <json>`. We track the most recent event name
  // and pair it with the next data line; both are valid framings
  // per the SSE spec.
  let pendingEventName: string | null = null;
  // Per-stream state ─ open blocks indexed by `content_block_start.index`,
  // accumulated thinking signature bytes per index (delivered via
  // `signature_delta` events), and the cumulative usage snapshot.
  const openBlocks = new Map<number, OpenBlock>();
  let cumUsage: CumulativeUsage | null = null;
  // Per-turn synthetic turn id used to mint stable tool-call ids
  // when Anthropic doesn't (it does — but we still prefix for
  // collision avoidance with sibling dialects on the renderer).
  const turnId = randomUUID();
  void turnId; // currently informational only; reserved for future use

  /**
   * Process one buffered `event: …\n…data: …` block. Anthropic
   * always pairs event names with their data; we tolerate either
   * order. Yields zero-or-more `ChatStreamDelta`s; returns true when
   * the stream should stop (a `message_stop` event landed).
   */
  async function* processFrame(frame: string): AsyncGenerator<ChatStreamDelta, boolean> {
    const lines = frame.split('\n');
    let eventName: string | null = pendingEventName;
    let dataPayload: string | null = null;
    for (const raw of lines) {
      const line = raw.trim();
      if (line.length === 0) continue;
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataPayload = line.slice(5).trim();
      }
    }
    pendingEventName = null;
    if (dataPayload === null || eventName === null) return false;
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(dataPayload) as Record<string, unknown>;
    } catch {
      log.warn('failed to parse SSE payload; skipping frame', {
        eventName,
        preview: dataPayload.slice(0, 200)
      });
      return false;
    }

    switch (eventName) {
      case 'message_start': {
        const message = payload['message'] as Record<string, unknown> | undefined;
        const usage = (message?.['usage'] as CumulativeUsage | undefined) ?? null;
        if (usage) {
          cumUsage = { ...usage };
          yield { usage: toCanonicalUsage(cumUsage) };
        }
        const msgId = typeof message?.['id'] === 'string' ? message['id'] : undefined;
        if (msgId) yield { anthropicMessageId: msgId };
        const startDiag = parseAnthropicCacheDiagnostics(message?.['diagnostics']);
        if (startDiag) {
          yield { anthropicCacheDiagnostics: { cacheMissReason: startDiag.cacheMissReason } };
        }
        return false;
      }
      case 'content_block_start': {
        const index = typeof payload['index'] === 'number' ? (payload['index'] as number) : 0;
        const block = payload['content_block'] as Record<string, unknown> | undefined;
        const t = typeof block?.['type'] === 'string' ? (block?.['type'] as string) : '';
        const open: OpenBlock = {
          type:
            t === 'text'
              ? 'text'
              : t === 'thinking'
                ? 'thinking'
                : t === 'tool_use'
                  ? 'tool_use'
                  : t === 'image'
                    ? 'image'
                    : 'other'
        };
        if (open.type === 'image') {
          const source = block?.['source'] as Record<string, unknown> | undefined;
          const mediaType =
            typeof source?.['media_type'] === 'string' ? (source['media_type'] as string) : '';
          const data = typeof source?.['data'] === 'string' ? (source['data'] as string) : '';
          if (mediaType.startsWith('image/') && data.length > 0) {
            yield { imageDelta: { mime: mediaType, base64: data } };
          }
        }
        if (open.type === 'tool_use') {
          open.toolUseId =
            typeof block?.['id'] === 'string' ? (block?.['id'] as string) : undefined;
          open.toolName =
            typeof block?.['name'] === 'string' ? (block?.['name'] as string) : undefined;
          // Open the tool call slot on the consumer side with a
          // zero-arg snapshot so the renderer can paint the row
          // immediately (mirrors the OpenAI streaming-args pattern).
          if (open.toolUseId !== undefined) {
            const toolCallDelta: ChatStreamDelta['toolCallDelta'] = {
              index,
              id: open.toolUseId
            };
            if (open.toolName !== undefined) toolCallDelta.name = open.toolName;
            toolCallDelta.argumentsDelta = '';
            yield { toolCallDelta };
          }
        }
        openBlocks.set(index, open);
        return false;
      }
      case 'content_block_delta': {
        const index = typeof payload['index'] === 'number' ? (payload['index'] as number) : 0;
        const open = openBlocks.get(index);
        const delta = payload['delta'] as Record<string, unknown> | undefined;
        const dtype = typeof delta?.['type'] === 'string' ? (delta?.['type'] as string) : '';
        if (dtype === 'text_delta' && typeof delta?.['text'] === 'string') {
          yield { contentDelta: delta['text'] as string };
        } else if (dtype === 'thinking_delta' && typeof delta?.['thinking'] === 'string') {
          yield { reasoningDelta: delta['thinking'] as string };
        } else if (dtype === 'signature_delta') {
          // Per the 2026 docs, `signature_delta` carries the
          // encrypted bytes that finalize a thinking block's
          // signature. The signature MUST be round-tripped to
          // Anthropic on the next user turn for thinking models to
          // keep their plan coherent — Claude thinking-capable
          // models that don't see their prior signature respond
          // with degraded reasoning ("I'm not sure how I got here…")
          // or, for compaction-paired turns, an outright API error.
          //
          // Source: https://platform.claude.com/docs/en/docs/build-with-claude/extended-thinking
          //         https://platform.claude.com/docs/en/docs/build-with-claude/streaming
          //
          // Accumulate per open block. We emit one terminal
          // `reasoningSignature` ChatStreamDelta on
          // `content_block_stop` so the consume layer sees a single
          // concat-on-arrival signature per closed thinking block.
          const sig = typeof delta?.['signature'] === 'string' ? (delta?.['signature'] as string) : '';
          if (sig.length > 0 && open !== undefined && open.type === 'thinking') {
            open.signatureBuf = (open.signatureBuf ?? '') + sig;
          }
        } else if (
          dtype === 'input_json_delta' &&
          typeof delta?.['partial_json'] === 'string' &&
          open?.type === 'tool_use'
        ) {
          const argumentsDelta = delta['partial_json'] as string;
          const toolCallDelta: ChatStreamDelta['toolCallDelta'] = { index };
          if (open.toolUseId !== undefined) toolCallDelta.id = open.toolUseId;
          if (open.toolName !== undefined) toolCallDelta.name = open.toolName;
          toolCallDelta.argumentsDelta = argumentsDelta;
          yield { toolCallDelta };
        }
        return false;
      }
      case 'content_block_stop': {
        const index = typeof payload['index'] === 'number' ? (payload['index'] as number) : 0;
        const closing = openBlocks.get(index);
        // Phase 8 (2026): emit the terminal thinking-block signature
        // exactly once, on close. The consume layer concatenates these
        // across multiple thinking blocks in the same turn so
        // multi-block thinking (rare but legal) still round-trips
        // every signature byte. We emit BEFORE removing the block
        // from the open map so a malformed stream that sends a
        // duplicate `content_block_stop` for the same index is a
        // no-op on the second call.
        if (
          closing !== undefined &&
          closing.type === 'thinking' &&
          typeof closing.signatureBuf === 'string' &&
          closing.signatureBuf.length > 0
        ) {
          yield { reasoningSignature: closing.signatureBuf };
        }
        openBlocks.delete(index);
        return false;
      }
      case 'message_delta': {
        const delta = payload['delta'] as Record<string, unknown> | undefined;
        const stopReason =
          typeof delta?.['stop_reason'] === 'string' ? (delta?.['stop_reason'] as string) : null;
        const usage = payload['usage'] as CumulativeUsage | undefined;
        if (usage) {
          // CRITICAL: `usage` here is CUMULATIVE — REPLACE the
          // running snapshot field-by-field, NEVER add.
          cumUsage = { ...(cumUsage ?? {}), ...usage };
          yield { usage: toCanonicalUsage(cumUsage) };
        }
        const deltaDiag = parseAnthropicCacheDiagnostics(payload['diagnostics']);
        if (deltaDiag) {
          yield { anthropicCacheDiagnostics: { cacheMissReason: deltaDiag.cacheMissReason } };
        }
        if (stopReason !== null) {
          yield { finishReason: mapStopReason(stopReason) };
        }
        return false;
      }
      case 'message_stop':
        return true;
      case 'ping':
        // Keep-alive only; the inactivity watchdog's `poke` is
        // handled at the read-loop level.
        return false;
      case 'error': {
        const errorBlock = payload['error'] as Record<string, unknown> | undefined;
        const errType =
          typeof errorBlock?.['type'] === 'string' ? (errorBlock?.['type'] as string) : 'error';
        const errMessage =
          typeof errorBlock?.['message'] === 'string'
            ? (errorBlock?.['message'] as string)
            : 'Anthropic mid-stream error.';
        const rateLimited = errType === 'overloaded_error' || errType === 'rate_limit_error';
        if (rateLimited) markRateLimited(req.providerId);
        throw new ProviderError({
          kind: rateLimited ? 'rate-limit' : 'server',
          status: 200,
          providerId: req.providerId,
          providerName: provider.name,
          friendlyMessage: rateLimited
            ? `${provider.name}: Rate limit / overload (mid-stream) — ${errMessage}`
            : `${provider.name}: Mid-stream error — ${errMessage}`,
          surface: 'chat',
          rawBody: dataPayload.slice(0, 1000)
        });
      }
      default:
        return false;
    }
  }

  try {
    // Shared SSE byte → frame helper. Owns CRLF normalization, EOF
    // flush, and inactivity-watchdog poke. We keep the dialect-
    // specific bits (`event:`/`data:` pairing, `message_stop`
    // termination) right here.
    for await (const frame of readSseFrames({
      body: res.body,
      watch,
      onInactivity: () => {
        log.warn('provider stream inactive mid-read', {
          url,
          providerId: req.providerId
        });
      }
    })) {
      watch.poke();
      const gen = processFrame(frame);
      let r = await gen.next();
      while (!r.done) {
        yield r.value;
        r = await gen.next();
      }
      if (r.value === true) {
        // `message_stop` arrived — return; the helper's cleanup
        // cancels the body reader so the HTTP socket closes
        // promptly instead of waiting for GC.
        return;
      }
    }
  } finally {
    watch.dispose();
  }
}

/**
 * Convert an Anthropic cumulative-usage snapshot into the canonical
 * camelCase `TokenUsage`. Anthropic's `output_tokens` is the
 * completion count; `cache_creation_input_tokens` + `cache_read_input_tokens`
 * surface separately as `cacheCreationTokens` / `cachedPromptTokens`.
 *
 * Anthropic does NOT report a separate reasoning-token count on the
 * wire; the reasoning tokens are already accounted for inside
 * `output_tokens`. We leave `reasoningTokens` undefined here; the
 * UI surface knows to display the orchestrator-level number when
 * available.
 */
function toCanonicalUsage(u: CumulativeUsage): TokenUsage {
  const prompt = typeof u.input_tokens === 'number' ? u.input_tokens : 0;
  const completion = typeof u.output_tokens === 'number' ? u.output_tokens : 0;
  const out: TokenUsage = {
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: prompt + completion
  };
  if (typeof u.cache_read_input_tokens === 'number') {
    out.cachedPromptTokens = u.cache_read_input_tokens;
  }
  if (typeof u.cache_creation_input_tokens === 'number') {
    out.cacheCreationTokens = u.cache_creation_input_tokens;
  }
  return out;
}

/**
 * Map Anthropic 2026 `stop_reason` values to the dialect-agnostic
 * finish-reason vocabulary the orchestrator already speaks. Unknown
 * values pass through verbatim so a future variant the orchestrator
 * doesn't recognise still arrives as an observable finish reason
 * instead of being silently swallowed.
 */
function mapStopReason(stopReason: string): string {
  switch (stopReason) {
    case 'end_turn':
      return 'stop';
    case 'max_tokens':
      return 'length';
    case 'tool_use':
      return 'tool_calls';
    case 'pause_turn':
      return 'pause';
    case 'stop_sequence':
      return 'stop';
    case 'model_context_window_exceeded':
      return 'length';
    default:
      return stopReason;
  }
}

/**
 * Translate the internal OpenAI-shaped `ChatMessage[]` into
 * Anthropic's wire structure. Two divergences to reconcile:
 *
 *   1. Anthropic hoists the system message into a TOP-LEVEL `system`
 *      string. Multi-system arrays are concatenated with `\n\n` so
 *      the harness's stacked sections still read as one prompt.
 *
 *   2. Anthropic's content is a list of typed blocks, not a flat
 *      string. We render:
 *        - `assistant` messages with `content` only → `[{type:'text', text}]`
 *        - `assistant` messages with `tool_calls`   → `[{type:'tool_use', id, name, input}, ...]`
 *           (text block first when both content + tool_calls are present)
 *        - `tool` messages → `{role:'user', content:[{type:'tool_result', tool_use_id, content}]}`
 *        - `user` messages → `[{type:'text', text}]`
 *
 *   3. Empty assistant content paired with tool_calls is rendered as
 *      tool_use blocks only — Anthropic rejects a `null` content +
 *      tool_use combination but is happy with a single tool_use block.
 *
 * Pure (no IO). The translation is bidirectionally stable: a turn
 * persisted with reasoning_content can be echoed back as a
 * `thinking` block on the next request (handled at a higher level —
 * `replayTranscript` plus the orchestrator's persistence layer).
 */
interface AnthropicWireBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking' | 'image' | 'document';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
  thinking?: string;
  signature?: string;
  source?:
    | { type: 'base64'; media_type: string; data: string }
    | { type: 'file'; file_id: string };
}

interface AnthropicWireMessage {
  role: 'user' | 'assistant';
  content: AnthropicWireBlock[];
}

async function toAnthropicMessages(
  messages: readonly ChatMessage[],
  provider: ProviderWithKey
): Promise<{ system: string; messages: AnthropicWireMessage[] }> {
  const systemParts: string[] = [];
  const wire: AnthropicWireMessage[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      const c = m.content;
      if (typeof c === 'string' && c.length > 0) systemParts.push(c);
      continue;
    }
    if (m.role === 'tool') {
      // OpenAI tool message → Anthropic `user` message carrying a
      // `tool_result` block. The id comes from `tool_call_id`; if
      // the persisted record is malformed the tool_use_id falls
      // back to the message's `name` so something attaches.
      const tool_use_id =
        typeof m.tool_call_id === 'string' && m.tool_call_id.length > 0
          ? m.tool_call_id
          : (m.name ?? 'unknown');
      const block: AnthropicWireBlock = {
        type: 'tool_result',
        tool_use_id,
        content: typeof m.content === 'string' ? m.content : ''
      };
      wire.push({ role: 'user', content: [block] });
      continue;
    }
    if (m.role === 'user') {
      if (userContentHasAudioParts(m.content)) {
        throw new ProviderError({
          kind: 'unknown',
          status: 400,
          providerId: req.providerId,
          providerName: provider.name,
          friendlyMessage: `${provider.name}: Native audio attachments are not supported by this provider.`,
          surface: 'chat',
          rawBody: ''
        });
      }
      const fileRefs = await resolveFileRefsForUserContent(provider, m.content);
      wire.push({ role: 'user', content: toAnthropicUserBlocks(m.content, fileRefs) });
      continue;
    }
    // assistant — block ORDER matters: per Anthropic's docs, thinking
    // blocks must appear FIRST (before text and tool_use) so the model
    // can resume its reasoning chain from the persisted plan.
    // Source: https://platform.claude.com/docs/en/docs/build-with-claude/extended-thinking
    //         "Preserving thinking blocks" + "Block order matters"
    const blocks: AnthropicWireBlock[] = [];
    if (
      typeof m.reasoning_content === 'string' &&
      m.reasoning_content.length > 0 &&
      typeof m.reasoning_signature === 'string' &&
      m.reasoning_signature.length > 0
    ) {
      // Phase 8 (2026): only emit a `thinking` block when BOTH the
      // text AND signature are present. Anthropic rejects a thinking
      // block with a missing signature (signature-bound auth check),
      // and a signature without text is meaningless. Older transcripts
      // persisted before signature-plumbing landed simply skip the
      // block; the Anthropic API auto-filters thinking blocks for
      // older Sonnet/Haiku model classes anyway, so dropping is
      // backward-compatible.
      blocks.push({
        type: 'thinking',
        thinking: m.reasoning_content,
        signature: m.reasoning_signature
      });
    }
    if (typeof m.content === 'string' && m.content.length > 0) {
      blocks.push({ type: 'text', text: m.content });
    }
    if (m.tool_calls && m.tool_calls.length > 0) {
      for (const tc of m.tool_calls) {
        let input: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(tc.function.arguments || '{}') as unknown;
          if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
            input = parsed as Record<string, unknown>;
          }
        } catch {
          // Malformed JSON — Anthropic requires an object. Fall
          // through to `{}` so the request still round-trips; the
          // executor's failure will surface as a normal tool error.
        }
        blocks.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input
        });
      }
    }
    // Skip empty assistant turns entirely — Anthropic rejects an
    // empty `content` array. Pre-fix transcripts shouldn't produce
    // them but the guard is cheap.
    if (blocks.length === 0) continue;
    wire.push({ role: 'assistant', content: blocks });
  }
  return { system: systemParts.join('\n\n'), messages: wire };
}

/** Test-only export — surfaces the body translator so the unit test
 *  can assert on the exact wire shape without spinning up a mock
 *  fetch + SSE stream. Not used in production. */
export const __anthropicInternals = {
  toAnthropicMessages,
  mapStopReason,
  toCanonicalUsage
};
