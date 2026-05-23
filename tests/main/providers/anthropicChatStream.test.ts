/**
 * `streamChat` over the Anthropic-native dialect — SSE parsing
 * regression suite (Phase 8 — 2026).
 *
 * Locks the contract that the orchestrator loop above
 * (runLoop / consumeChatStream / handleAssistantTurn) sees an
 * IDENTICAL `ChatStreamDelta` shape regardless of dialect:
 * dialect-specific differences (cumulative usage replay,
 * thinking-block signatures, structured content blocks,
 * pause_turn lifecycle) MUST be flattened inside
 * `anthropicChatStream.ts` so nothing downstream branches on
 * dialect.
 *
 * High-leverage cases:
 *
 *   - **Cumulative-usage trap** — verifies that `message_start.usage`
 *     + `message_delta.usage` are NOT summed (LangChain-class bug).
 *     Without this, `cachedPromptTokens` double-counts on every turn.
 *
 *   - **Thinking signature round-trip** — verifies that
 *     `signature_delta` events accumulate per-block and emit one
 *     terminal `reasoningSignature` ChatStreamDelta on
 *     `content_block_stop`. Required for Claude thinking-capable
 *     models to keep their plan across turns.
 *
 *   - **Body translation** — covers system / multi-system / user /
 *     assistant-with-text-and-tool / tool-result and the new
 *     `{type:'thinking', thinking, signature}` block emitted when
 *     a replayed assistant message carries both `reasoning_content`
 *     and `reasoning_signature`.
 *
 *   - **Pause-turn lifecycle** — verifies stop_reason 'pause_turn'
 *     maps to finishReason 'pause' so the orchestrator's resume
 *     path triggers correctly.
 *
 *   - **Error event mid-stream** — verifies `overloaded_error` and
 *     `rate_limit_error` events surface as `ProviderError(kind:
 *     'rate-limit')` and feed the rate guard.
 *
 *   - **`pickThinkingConfig`** — covers the per-model dispatch:
 *     Opus 4.7 → adaptive, Sonnet 4.6 → adaptive, Sonnet 4.5 →
 *     enabled with budget, legacy Haiku → no thinking field.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ChatStreamDelta } from '@main/providers/chatClient';
import type { ChatMessage } from '@shared/types/chat';

vi.mock('@main/providers/providerStore', () => ({
  getProviderWithKey: vi.fn(async () => ({
    id: 'p',
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    dialect: 'anthropic-native',
    enabled: true,
    models: [],
    apiKey: 'sk-ant-test'
  }))
}));

import { streamChat } from '@main/providers/chatClient';
import { __anthropicInternals } from '@main/providers/anthropicChatStream';
import { _resetForTests as resetRateGuard } from '@main/providers/providerRateGuard';

const { toAnthropicMessages, mapStopReason, toCanonicalUsage, pickThinkingConfig } =
  __anthropicInternals;

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** Build an SSE byte stream from a list of `event: …\ndata: …\n\n` frames. */
function buildSseBody(frames: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) controller.enqueue(encode(f));
      controller.close();
    }
  });
}

/** Format one canonical Anthropic SSE frame. */
function frame(eventName: string, data: Record<string, unknown>): string {
  return `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
}

interface MockOpts {
  /** HTTP status to surface (default 200). */
  status?: number;
  /** Raw error body when status !== 200. */
  errBody?: string;
}

function mockAnthropicResponse(frames: string[], opts: MockOpts = {}): {
  capturedRequest: { url: string; init: RequestInit | undefined } | null;
} {
  const captured: { url: string; init: RequestInit | undefined } | null = null;
  const ref = { current: captured };
  const mock = vi.fn(async (input: unknown, init?: unknown) => {
    ref.current = {
      url: typeof input === 'string' ? input : (input as URL).toString(),
      init: init as RequestInit | undefined
    };
    if (opts.status && opts.status !== 200) {
      return new Response(opts.errBody ?? 'err', {
        status: opts.status,
        statusText: 'Error'
      });
    }
    return new Response(buildSseBody(frames), {
      status: 200,
      statusText: 'OK',
      headers: { 'Content-Type': 'text/event-stream' }
    });
  });
  (globalThis as unknown as { fetch: typeof fetch }).fetch = mock as unknown as typeof fetch;
  return ref as { capturedRequest: { url: string; init: RequestInit | undefined } | null };
}

async function collect(messages: ChatMessage[] = []): Promise<ChatStreamDelta[]> {
  const out: ChatStreamDelta[] = [];
  for await (const d of streamChat({
    providerId: 'p',
    model: 'claude-opus-4-7',
    messages
  })) {
    out.push(d);
  }
  return out;
}

beforeEach(() => {
  vi.resetModules();
  resetRateGuard();
});

// ────────────────────────────────────────────────────────────────────
// Streaming round-trip
// ────────────────────────────────────────────────────────────────────

describe('streamChat (Anthropic native) — SSE parsing', () => {
  it('yields content deltas across multiple text_delta frames', async () => {
    mockAnthropicResponse([
      frame('message_start', {
        type: 'message_start',
        message: {
          id: 'msg_01',
          type: 'message',
          role: 'assistant',
          content: [],
          model: 'claude-opus-4-7',
          usage: { input_tokens: 10, output_tokens: 1 }
        }
      }),
      frame('content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' }
      }),
      frame('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Hello' }
      }),
      frame('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: ' world' }
      }),
      frame('content_block_stop', { type: 'content_block_stop', index: 0 }),
      frame('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { input_tokens: 10, output_tokens: 8 }
      }),
      frame('message_stop', { type: 'message_stop' })
    ]);
    const deltas = await collect();
    const text = deltas.map((d) => d.contentDelta ?? '').join('');
    expect(text).toBe('Hello world');
    const finish = deltas.find((d) => d.finishReason !== undefined);
    expect(finish?.finishReason).toBe('stop');
  });

  it('routes thinking_delta into reasoningDelta', async () => {
    mockAnthropicResponse([
      frame('message_start', {
        type: 'message_start',
        message: { id: 'msg_02', type: 'message', role: 'assistant', content: [], model: 'claude-opus-4-7', usage: { input_tokens: 5, output_tokens: 1 } }
      }),
      frame('content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'thinking', thinking: '', signature: '' }
      }),
      frame('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'Let me think…' }
      }),
      frame('content_block_stop', { type: 'content_block_stop', index: 0 }),
      frame('message_stop', { type: 'message_stop' })
    ]);
    const deltas = await collect();
    expect(deltas[0]?.reasoningDelta).toBeUndefined(); // first delta is `usage`
    expect(deltas.some((d) => d.reasoningDelta === 'Let me think…')).toBe(true);
  });

  it('synthesizes toolCallDelta from tool_use + input_json_delta frames', async () => {
    mockAnthropicResponse([
      frame('message_start', {
        type: 'message_start',
        message: { id: 'msg_03', type: 'message', role: 'assistant', content: [], model: 'claude-opus-4-7', usage: { input_tokens: 5, output_tokens: 1 } }
      }),
      frame('content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'toolu_01abc', name: 'get_weather', input: {} }
      }),
      frame('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"city":"' }
      }),
      frame('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: 'Tokyo"}' }
      }),
      frame('content_block_stop', { type: 'content_block_stop', index: 0 }),
      frame('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: 'tool_use' },
        usage: { input_tokens: 5, output_tokens: 4 }
      }),
      frame('message_stop', { type: 'message_stop' })
    ]);
    const deltas = await collect();
    const toolCallDeltas = deltas.filter((d) => d.toolCallDelta);
    expect(toolCallDeltas.length).toBeGreaterThanOrEqual(2);
    const opener = toolCallDeltas[0]!.toolCallDelta!;
    expect(opener.id).toBe('toolu_01abc');
    expect(opener.name).toBe('get_weather');
    // Concatenated argumentsDelta across the two partial_json frames
    // should reconstruct the full JSON.
    const args = toolCallDeltas
      .map((d) => d.toolCallDelta?.argumentsDelta ?? '')
      .join('');
    expect(args).toContain('"city":"Tokyo"');
    const finish = deltas.find((d) => d.finishReason !== undefined);
    expect(finish?.finishReason).toBe('tool_calls');
  });
});

// ────────────────────────────────────────────────────────────────────
// CRITICAL — cumulative-usage trap (LangChain.js March 2026 bug class)
// ────────────────────────────────────────────────────────────────────

describe('streamChat (Anthropic native) — cumulative-usage trap', () => {
  it('REPLACES cache fields across message_start and message_delta (NEVER sums)', async () => {
    // The bug: both `message_start.usage` and `message_delta.usage`
    // carry `cache_read_input_tokens` cumulatively. A naive reducer
    // that ADDS the two ends up reporting 1000 cached tokens when
    // the actual figure is 500. Here we feed exactly that scenario
    // and assert that the FINAL `usage` delta carries 500, not 1000.
    mockAnthropicResponse([
      frame('message_start', {
        type: 'message_start',
        message: {
          id: 'msg_cache',
          type: 'message',
          role: 'assistant',
          content: [],
          model: 'claude-opus-4-7',
          usage: {
            input_tokens: 1000,
            output_tokens: 1,
            cache_creation_input_tokens: 200,
            cache_read_input_tokens: 500
          }
        }
      }),
      frame('content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' }
      }),
      frame('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Hi.' }
      }),
      frame('content_block_stop', { type: 'content_block_stop', index: 0 }),
      frame('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        // CUMULATIVE — same cache_read figure, NOT additional bytes.
        usage: {
          input_tokens: 1000,
          output_tokens: 12,
          cache_creation_input_tokens: 200,
          cache_read_input_tokens: 500
        }
      }),
      frame('message_stop', { type: 'message_stop' })
    ]);
    const deltas = await collect();
    const usageFrames = deltas.filter((d) => d.usage !== undefined);
    expect(usageFrames.length).toBeGreaterThanOrEqual(2);
    const last = usageFrames[usageFrames.length - 1]!.usage!;
    expect(last.promptTokens).toBe(1000);
    expect(last.completionTokens).toBe(12);
    // The critical assertion — IF a future refactor accidentally
    // sums the cache fields, this would be 1000. Catching that
    // class of regression is the entire point of the test.
    expect(last.cachedPromptTokens).toBe(500);
    expect(last.cacheCreationTokens).toBe(200);
  });
});

// ────────────────────────────────────────────────────────────────────
// Thinking signature round-trip
// ────────────────────────────────────────────────────────────────────

describe('streamChat (Anthropic native) — thinking signature round-trip', () => {
  it('emits a single reasoningSignature ChatStreamDelta on content_block_stop for a thinking block', async () => {
    mockAnthropicResponse([
      frame('message_start', {
        type: 'message_start',
        message: { id: 'msg_sig', type: 'message', role: 'assistant', content: [], model: 'claude-opus-4-7', usage: { input_tokens: 5, output_tokens: 1 } }
      }),
      frame('content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'thinking', thinking: '', signature: '' }
      }),
      frame('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'plan…' }
      }),
      frame('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'signature_delta', signature: 'EqQBCgIYAhIM-OPAQUE-' }
      }),
      frame('content_block_stop', { type: 'content_block_stop', index: 0 }),
      // Follow-up text block to ensure the signature emission
      // happens BEFORE downstream content (matches the observed
      // wire ordering documented in Anthropic 2026 docs).
      frame('content_block_start', {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'text', text: '' }
      }),
      frame('content_block_delta', {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'text_delta', text: 'OK.' }
      }),
      frame('content_block_stop', { type: 'content_block_stop', index: 1 }),
      frame('message_stop', { type: 'message_stop' })
    ]);
    const deltas = await collect();
    const sigFrames = deltas.filter((d) => d.reasoningSignature !== undefined);
    expect(sigFrames).toHaveLength(1);
    expect(sigFrames[0]!.reasoningSignature).toBe('EqQBCgIYAhIM-OPAQUE-');
    // Order: signature must precede the first downstream contentDelta.
    const sigIdx = deltas.findIndex((d) => d.reasoningSignature !== undefined);
    const firstTextIdx = deltas.findIndex((d) => d.contentDelta === 'OK.');
    expect(sigIdx).toBeGreaterThanOrEqual(0);
    expect(firstTextIdx).toBeGreaterThan(sigIdx);
  });

  it('does NOT emit reasoningSignature when no signature_delta arrives', async () => {
    mockAnthropicResponse([
      frame('message_start', {
        type: 'message_start',
        message: { id: 'msg_no_sig', type: 'message', role: 'assistant', content: [], model: 'claude-opus-4-7', usage: { input_tokens: 5, output_tokens: 1 } }
      }),
      frame('content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' }
      }),
      frame('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Plain reply.' }
      }),
      frame('content_block_stop', { type: 'content_block_stop', index: 0 }),
      frame('message_stop', { type: 'message_stop' })
    ]);
    const deltas = await collect();
    const sigFrames = deltas.filter((d) => d.reasoningSignature !== undefined);
    expect(sigFrames).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────────
// pause_turn + error events
// ────────────────────────────────────────────────────────────────────

describe('streamChat (Anthropic native) — stop reasons and errors', () => {
  it('maps pause_turn → finishReason: pause', async () => {
    mockAnthropicResponse([
      frame('message_start', {
        type: 'message_start',
        message: { id: 'msg_pause', type: 'message', role: 'assistant', content: [], model: 'claude-opus-4-7', usage: { input_tokens: 5, output_tokens: 1 } }
      }),
      frame('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
      frame('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '...' } }),
      frame('content_block_stop', { type: 'content_block_stop', index: 0 }),
      frame('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: 'pause_turn' },
        usage: { input_tokens: 5, output_tokens: 1 }
      }),
      frame('message_stop', { type: 'message_stop' })
    ]);
    const deltas = await collect();
    const finish = deltas.find((d) => d.finishReason !== undefined);
    expect(finish?.finishReason).toBe('pause');
  });

  it('maps end_turn / max_tokens / tool_use / model_context_window_exceeded correctly', () => {
    expect(mapStopReason('end_turn')).toBe('stop');
    expect(mapStopReason('max_tokens')).toBe('length');
    expect(mapStopReason('tool_use')).toBe('tool_calls');
    expect(mapStopReason('stop_sequence')).toBe('stop');
    expect(mapStopReason('model_context_window_exceeded')).toBe('length');
    expect(mapStopReason('pause_turn')).toBe('pause');
    // Unknown reasons pass through verbatim so a future variant the
    // orchestrator doesn't recognise still arrives observably.
    expect(mapStopReason('hypothetical_future_value')).toBe('hypothetical_future_value');
  });

  it('throws ProviderError(rate-limit) on a mid-stream overloaded_error event', async () => {
    mockAnthropicResponse([
      frame('message_start', {
        type: 'message_start',
        message: { id: 'msg_err', type: 'message', role: 'assistant', content: [], model: 'claude-opus-4-7', usage: { input_tokens: 5, output_tokens: 1 } }
      }),
      frame('error', {
        type: 'error',
        error: { type: 'overloaded_error', message: 'Server overloaded' }
      })
    ]);
    await expect(collect()).rejects.toMatchObject({
      name: 'ProviderError',
      kind: 'rate-limit'
    });
  });

  it('throws ProviderError on a non-200 initial response', async () => {
    mockAnthropicResponse([], {
      status: 401,
      errBody: '{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}'
    });
    await expect(collect()).rejects.toMatchObject({
      name: 'ProviderError',
      kind: 'auth',
      status: 401
    });
  });
});

// ────────────────────────────────────────────────────────────────────
// Body translation (toAnthropicMessages)
// ────────────────────────────────────────────────────────────────────

describe('toAnthropicMessages — body translation', () => {
  it('hoists a single system message to the top-level system field', () => {
    const result = toAnthropicMessages([
      { role: 'system', content: 'You are V.' },
      { role: 'user', content: 'hi' }
    ]);
    expect(result.system).toBe('You are V.');
    expect(result.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'hi' }] }
    ]);
  });

  it('concatenates multiple system messages with a blank line separator', () => {
    const result = toAnthropicMessages([
      { role: 'system', content: 'You are V.' },
      { role: 'system', content: 'Be terse.' },
      { role: 'user', content: 'hi' }
    ]);
    expect(result.system).toBe('You are V.\n\nBe terse.');
  });

  it('translates assistant tool_calls into tool_use blocks (text first when both present)', () => {
    const result = toAnthropicMessages([
      { role: 'user', content: 'compute' },
      {
        role: 'assistant',
        content: 'one moment',
        tool_calls: [
          {
            id: 'toolu_01',
            type: 'function',
            function: { name: 'calc', arguments: '{"x":1}' }
          }
        ]
      }
    ]);
    const assistant = result.messages[1]!;
    expect(assistant.role).toBe('assistant');
    expect(assistant.content[0]).toMatchObject({ type: 'text', text: 'one moment' });
    expect(assistant.content[1]).toMatchObject({
      type: 'tool_use',
      id: 'toolu_01',
      name: 'calc',
      input: { x: 1 }
    });
  });

  it('translates tool messages into user role with tool_result blocks', () => {
    const result = toAnthropicMessages([
      { role: 'tool', content: '{"answer":42}', tool_call_id: 'toolu_01', name: 'calc' }
    ]);
    expect(result.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_01', content: '{"answer":42}' }
        ]
      }
    ]);
  });

  it('emits a {type:thinking, thinking, signature} block FIRST when both reasoning fields are present', () => {
    // Phase 8 round-trip: a replayed assistant message that carries
    // both reasoning_content and reasoning_signature must surface
    // back to Anthropic as a thinking block, BEFORE the text block.
    // Block order matters per the 2026 docs.
    const result = toAnthropicMessages([
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: 'OK.',
        reasoning_content: 'plan…',
        reasoning_signature: 'EqQBOPAQUE'
      }
    ]);
    const assistant = result.messages[1]!;
    expect(assistant.content[0]).toMatchObject({
      type: 'thinking',
      thinking: 'plan…',
      signature: 'EqQBOPAQUE'
    });
    expect(assistant.content[1]).toMatchObject({ type: 'text', text: 'OK.' });
  });

  it('drops the thinking block when reasoning_content is present but signature is missing', () => {
    // Older transcripts (pre-Phase-8) only carry reasoning_content.
    // Anthropic rejects a thinking block without a signature, so we
    // skip the block entirely and keep just the text. The API
    // auto-filters legacy thinking blocks for older Sonnet/Haiku
    // model classes anyway, so dropping is backward-compatible.
    const result = toAnthropicMessages([
      {
        role: 'assistant',
        content: 'OK.',
        reasoning_content: 'plan…'
        // no reasoning_signature
      }
    ]);
    const assistant = result.messages[0]!;
    expect(assistant.content).toHaveLength(1);
    expect(assistant.content[0]).toMatchObject({ type: 'text', text: 'OK.' });
  });

  it('skips empty assistant turns (no content, no tool_calls)', () => {
    // Anthropic rejects an empty content array; an OpenAI-canonical
    // assistant turn with nothing to say (rare — pure pass-through)
    // must be dropped entirely.
    const result = toAnthropicMessages([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '' },
      { role: 'user', content: 'still there?' }
    ]);
    expect(result.messages).toHaveLength(2);
    expect(result.messages.every((m) => m.role === 'user')).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────
// toCanonicalUsage — normalization spot-checks
// ────────────────────────────────────────────────────────────────────

describe('toCanonicalUsage — normalization', () => {
  it('maps Anthropic snake_case to canonical camelCase', () => {
    const out = toCanonicalUsage({
      input_tokens: 100,
      output_tokens: 25,
      cache_creation_input_tokens: 30,
      cache_read_input_tokens: 70
    });
    expect(out).toEqual({
      promptTokens: 100,
      completionTokens: 25,
      totalTokens: 125,
      cachedPromptTokens: 70,
      cacheCreationTokens: 30
    });
  });

  it('omits cache fields when the wire never reported them', () => {
    const out = toCanonicalUsage({ input_tokens: 50, output_tokens: 10 });
    expect(out).toEqual({
      promptTokens: 50,
      completionTokens: 10,
      totalTokens: 60
    });
  });
});

// ────────────────────────────────────────────────────────────────────
// pickThinkingConfig — per-model dispatch
// ────────────────────────────────────────────────────────────────────

describe('pickThinkingConfig — per-model dispatch', () => {
  it('returns null when thinking is not enabled', () => {
    expect(pickThinkingConfig('claude-opus-4-7', undefined, 4096)).toBeNull();
    expect(
      pickThinkingConfig('claude-opus-4-7', { enabled: false }, 4096)
    ).toBeNull();
  });

  it('returns null for known non-thinking models even when enabled', () => {
    expect(pickThinkingConfig('claude-haiku-3', { enabled: true }, 4096)).toBeNull();
    expect(pickThinkingConfig('claude-haiku-3.5', { enabled: true }, 4096)).toBeNull();
    expect(pickThinkingConfig('claude-instant-1.2', { enabled: true }, 4096)).toBeNull();
  });

  it('returns adaptive type for 2026 flagship models', () => {
    expect(pickThinkingConfig('claude-opus-4-7', { enabled: true }, 4096)).toEqual({
      type: 'adaptive'
    });
    expect(pickThinkingConfig('claude-opus-4-6', { enabled: true }, 4096)).toEqual({
      type: 'adaptive'
    });
    expect(pickThinkingConfig('claude-sonnet-4-6', { enabled: true }, 4096)).toEqual({
      type: 'adaptive'
    });
    expect(pickThinkingConfig('claude-mythos-preview', { enabled: true }, 4096)).toEqual({
      type: 'adaptive'
    });
    // Dated suffix should still match.
    expect(
      pickThinkingConfig('claude-opus-4-7-20260101', { enabled: true }, 4096)
    ).toEqual({ type: 'adaptive' });
  });

  it('returns enabled type with budget_tokens for older thinking-capable models', () => {
    // Anthropic requires `budget_tokens < max_tokens`. Use 16384 so
    // the requested medium budget (8192) lands well under the cap
    // (we exercise the cap separately in the next test).
    const out = pickThinkingConfig(
      'claude-sonnet-4-5',
      { enabled: true, effort: 'medium' },
      16384
    );
    expect(out).toEqual({ type: 'enabled', budget_tokens: 8192 });
  });

  it('clamps budget_tokens to (max_tokens - 1)', () => {
    // effort=high requests 16384, but max_tokens=2048 caps the budget.
    const out = pickThinkingConfig(
      'claude-sonnet-4-5',
      { enabled: true, effort: 'high' },
      2048
    );
    expect(out).toEqual({ type: 'enabled', budget_tokens: 2047 });
  });

  it('honors effort low / high overrides', () => {
    expect(
      pickThinkingConfig('claude-haiku-4-5', { enabled: true, effort: 'low' }, 4096)
    ).toEqual({ type: 'enabled', budget_tokens: 2048 });
    expect(
      pickThinkingConfig('claude-haiku-4-5', { enabled: true, effort: 'high' }, 32768)
    ).toEqual({ type: 'enabled', budget_tokens: 16384 });
  });
});
