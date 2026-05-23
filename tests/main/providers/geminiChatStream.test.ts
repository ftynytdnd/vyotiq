/**
 * `streamChat` over the Gemini-native dialect — SSE parsing
 * regression suite (Phase 9 — 2026).
 *
 * Locks the contract that the orchestrator loop above
 * (runLoop / consumeChatStream / handleAssistantTurn) sees an
 * IDENTICAL `ChatStreamDelta` shape regardless of dialect:
 * dialect-specific differences (`systemInstruction` hoisting,
 * `parts[].thought:true` reasoning routing, `thoughtSignature`
 * round-trip, cumulative `usageMetadata`, finish-reason
 * canonicalization) MUST be flattened inside `geminiChatStream.ts`
 * so nothing downstream branches on dialect.
 *
 * High-leverage cases:
 *
 *   - **Body translation** — covers system / user / assistant /
 *     assistant-with-tool / tool-result and the Gemini-specific
 *     `thoughtSignature` round-trip on persisted `tool_calls[i]`.
 *
 *   - **Cumulative usage** — verifies that successive
 *     `usageMetadata` frames REPLACE rather than sum (matches the
 *     Anthropic pattern; without this guarantee the cached + thinking
 *     token counters would double-count on every turn).
 *
 *   - **`thoughtSignature` round-trip** — verifies that a
 *     `functionCall` part's signature surfaces on the matching
 *     `toolCallDelta` so the orchestrator can persist it.
 *
 *   - **Reasoning routing** — verifies that `{thought:true, text}`
 *     parts surface as `reasoningDelta`, not as plain text.
 *
 *   - **Finish-reason canonicalization** — covers STOP / MAX_TOKENS /
 *     TOOL_USE / SAFETY / MALFORMED_FUNCTION_CALL.
 *
 *   - **Error frame mid-stream** — verifies a top-level `error` SSE
 *     frame surfaces as `ProviderError(rate-limit)` for 429-class
 *     codes and `'server'` otherwise.
 *
 *   - **Auth mode** — verifies the header form is preferred and the
 *     `?key=` query-string form is selected when
 *     `provider.geminiAuthMode === 'query'`.
 *
 *   - **`alt=sse`** — verifies the request URL always carries the
 *     query parameter (Gemini's default is JSON-array streaming,
 *     which would never split into SSE frames).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ChatStreamDelta } from '@main/providers/chatClient';
import type { ChatMessage } from '@shared/types/chat';

let mockProvider: {
  id: string;
  name: string;
  baseUrl: string;
  dialect: string;
  enabled: boolean;
  models: unknown[];
  apiKey: string;
  geminiAuthMode?: 'header' | 'query';
} = {
  id: 'p',
  name: 'Gemini',
  baseUrl: 'https://generativelanguage.googleapis.com',
  dialect: 'gemini-native',
  enabled: true,
  models: [],
  apiKey: 'AIza-test'
};

vi.mock('@main/providers/providerStore', () => ({
  getProviderWithKey: vi.fn(async () => mockProvider)
}));

import { streamChat } from '@main/providers/chatClient';
import { __geminiInternals } from '@main/providers/geminiChatStream';
import { _resetForTests as resetRateGuard } from '@main/providers/providerRateGuard';

const { toGeminiContents, mapFinishReason, toCanonicalUsage } = __geminiInternals;

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function buildSseBody(frames: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) controller.enqueue(encode(f));
      controller.close();
    }
  });
}

function frame(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

interface CapturedRequest {
  url: string;
  init: RequestInit | undefined;
}

interface MockResult {
  captured: CapturedRequest[];
}

function mockGeminiResponse(
  frames: string[],
  opts: { status?: number; errBody?: string } = {}
): MockResult {
  const captured: CapturedRequest[] = [];
  const mock = vi.fn(async (input: unknown, init?: unknown) => {
    captured.push({
      url: typeof input === 'string' ? input : (input as URL).toString(),
      init: init as RequestInit | undefined
    });
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
  return { captured };
}

async function collect(messages: ChatMessage[] = []): Promise<ChatStreamDelta[]> {
  const out: ChatStreamDelta[] = [];
  for await (const d of streamChat({
    providerId: 'p',
    model: 'gemini-3-pro-preview',
    messages
  })) {
    out.push(d);
  }
  return out;
}

beforeEach(() => {
  vi.resetModules();
  resetRateGuard();
  mockProvider = {
    id: 'p',
    name: 'Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    dialect: 'gemini-native',
    enabled: true,
    models: [],
    apiKey: 'AIza-test'
  };
});

// ────────────────────────────────────────────────────────────────────
// Streaming round-trip
// ────────────────────────────────────────────────────────────────────

describe('streamChat (Gemini native) — SSE parsing', () => {
  it('yields content deltas across multiple text-only parts', async () => {
    mockGeminiResponse([
      frame({
        candidates: [
          { content: { role: 'model', parts: [{ text: 'Hello' }] } }
        ]
      }),
      frame({
        candidates: [
          { content: { role: 'model', parts: [{ text: ' world' }] } }
        ]
      }),
      frame({
        candidates: [{ finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2, totalTokenCount: 6 }
      })
    ]);
    const deltas = await collect();
    const text = deltas.map((d) => d.contentDelta ?? '').join('');
    expect(text).toBe('Hello world');
    const finish = deltas.find((d) => d.finishReason !== undefined);
    expect(finish?.finishReason).toBe('stop');
  });

  it('routes thought:true parts into reasoningDelta', async () => {
    mockGeminiResponse([
      frame({
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: 'Plan: …', thought: true }]
            }
          }
        ]
      }),
      frame({
        candidates: [
          { content: { role: 'model', parts: [{ text: 'Answer.' }] } }
        ]
      }),
      frame({
        candidates: [{ finishReason: 'STOP' }]
      })
    ]);
    const deltas = await collect();
    const reasoning = deltas.find((d) => d.reasoningDelta !== undefined);
    expect(reasoning?.reasoningDelta).toBe('Plan: …');
    const text = deltas.find((d) => d.contentDelta === 'Answer.');
    expect(text).toBeDefined();
  });

  it('synthesizes a single toolCallDelta with thoughtSignature for a functionCall part', async () => {
    mockGeminiResponse([
      frame({
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                {
                  functionCall: {
                    name: 'get_weather',
                    args: { city: 'Tokyo' }
                  },
                  thoughtSignature: 'OPAQUE_SIG_123'
                }
              ]
            }
          }
        ]
      }),
      frame({
        candidates: [{ finishReason: 'TOOL_USE' }],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 4, totalTokenCount: 9 }
      })
    ]);
    const deltas = await collect();
    const toolCallDeltas = deltas.filter((d) => d.toolCallDelta);
    expect(toolCallDeltas).toHaveLength(1);
    const call = toolCallDeltas[0]!.toolCallDelta!;
    expect(call.name).toBe('get_weather');
    expect(call.argumentsDelta).toBe('{"city":"Tokyo"}');
    expect(call.thoughtSignature).toBe('OPAQUE_SIG_123');
    expect(call.id).toBe('gem_0');
    const finish = deltas.find((d) => d.finishReason !== undefined);
    expect(finish?.finishReason).toBe('tool_calls');
  });
});

// ────────────────────────────────────────────────────────────────────
// CRITICAL — cumulative-usage trap
// ────────────────────────────────────────────────────────────────────

describe('streamChat (Gemini native) — cumulative-usage trap', () => {
  it('REPLACES usageMetadata across frames (NEVER sums)', async () => {
    // Same class of bug as the Anthropic cumulative-usage trap.
    // Gemini emits `usageMetadata` on multiple frames during a turn,
    // and each one is the FULL cumulative snapshot — not an
    // additional delta. Naive summing would double `cachedContent`
    // and `thoughts` token counts. The final value reported here
    // must match the LAST frame's snapshot, not the sum.
    mockGeminiResponse([
      frame({
        candidates: [
          { content: { role: 'model', parts: [{ text: 'Hi' }] } }
        ],
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 1,
          totalTokenCount: 101,
          thoughtsTokenCount: 50,
          cachedContentTokenCount: 60
        }
      }),
      frame({
        candidates: [{ finishReason: 'STOP' }],
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 12,
          totalTokenCount: 112,
          thoughtsTokenCount: 50,
          cachedContentTokenCount: 60
        }
      })
    ]);
    const deltas = await collect();
    const usageFrames = deltas.filter((d) => d.usage !== undefined);
    expect(usageFrames.length).toBeGreaterThanOrEqual(2);
    const last = usageFrames[usageFrames.length - 1]!.usage!;
    expect(last.promptTokens).toBe(100);
    expect(last.completionTokens).toBe(12);
    expect(last.totalTokens).toBe(112);
    // The crucial assertion — would be 100/120 if a future
    // refactor accidentally summed the cumulative reports.
    expect(last.reasoningTokens).toBe(50);
    expect(last.cachedPromptTokens).toBe(60);
  });
});

// ────────────────────────────────────────────────────────────────────
// Finish-reason mapping + safety blocks + error frames
// ────────────────────────────────────────────────────────────────────

describe('streamChat (Gemini native) — termination paths', () => {
  it('maps every documented finishReason onto canonical names', () => {
    expect(mapFinishReason('STOP')).toBe('stop');
    expect(mapFinishReason('MAX_TOKENS')).toBe('length');
    expect(mapFinishReason('TOOL_USE')).toBe('tool_calls');
    // Safety variants all collapse onto a single bucket the
    // orchestrator treats uniformly.
    expect(mapFinishReason('SAFETY')).toBe('safety');
    expect(mapFinishReason('PROHIBITED_CONTENT')).toBe('safety');
    expect(mapFinishReason('BLOCKLIST')).toBe('safety');
    expect(mapFinishReason('SPII')).toBe('safety');
    expect(mapFinishReason('IMAGE_SAFETY')).toBe('safety');
    expect(mapFinishReason('MALFORMED_FUNCTION_CALL')).toBe('tool_calls');
    // Unknown / less-common reasons pass through lowercased so
    // future variants are observable end-to-end.
    expect(mapFinishReason('RECITATION')).toBe('recitation');
    expect(mapFinishReason('LANGUAGE')).toBe('language');
    expect(mapFinishReason('OTHER')).toBe('other');
    expect(mapFinishReason('SOMETHING_NEW')).toBe('something_new');
  });

  it('emits a synthetic safety message + finishReason on promptFeedback.blockReason', async () => {
    // Safety blocks return BEFORE any candidates exist — the
    // transport synthesizes a renderer-visible explanation and
    // closes the stream cleanly so the run doesn't hang waiting
    // for content.
    mockGeminiResponse([
      frame({
        promptFeedback: { blockReason: 'PROHIBITED_CONTENT' }
      })
    ]);
    const deltas = await collect();
    const text = deltas.find((d) => d.contentDelta?.includes('Gemini safety'));
    expect(text?.contentDelta).toContain('PROHIBITED_CONTENT');
    const finish = deltas.find((d) => d.finishReason !== undefined);
    expect(finish?.finishReason).toBe('safety');
  });

  it('throws ProviderError(rate-limit) on a top-level 429 error frame', async () => {
    mockGeminiResponse([
      frame({
        error: {
          code: 429,
          message: 'Resource has been exhausted',
          status: 'RESOURCE_EXHAUSTED'
        }
      })
    ]);
    await expect(collect()).rejects.toMatchObject({
      name: 'ProviderError',
      kind: 'rate-limit'
    });
  });

  it('throws ProviderError(server) on a non-rate-limited error frame', async () => {
    mockGeminiResponse([
      frame({
        error: {
          code: 400,
          message: 'Function call signature missing or invalid',
          status: 'INVALID_ARGUMENT'
        }
      })
    ]);
    await expect(collect()).rejects.toMatchObject({
      name: 'ProviderError',
      kind: 'server'
    });
  });

  it('throws ProviderError on a non-200 initial response', async () => {
    mockGeminiResponse([], {
      status: 401,
      errBody: '{"error":{"code":401,"message":"API key not valid"}}'
    });
    await expect(collect()).rejects.toMatchObject({
      name: 'ProviderError',
      status: 401
    });
  });
});

// ────────────────────────────────────────────────────────────────────
// Request URL + auth mode
// ────────────────────────────────────────────────────────────────────

describe('streamChat (Gemini native) — request URL', () => {
  it('always appends ?alt=sse to the streamGenerateContent URL', async () => {
    const { captured } = mockGeminiResponse([
      frame({ candidates: [{ finishReason: 'STOP' }] })
    ]);
    await collect();
    expect(captured).toHaveLength(1);
    expect(captured[0]!.url).toContain(
      ':streamGenerateContent?alt=sse'
    );
  });

  it('uses the x-goog-api-key header by default', async () => {
    const { captured } = mockGeminiResponse([
      frame({ candidates: [{ finishReason: 'STOP' }] })
    ]);
    await collect();
    const headers = captured[0]!.init?.headers as Record<string, string>;
    expect(headers['x-goog-api-key']).toBe('AIza-test');
    expect(captured[0]!.url).not.toContain('key=');
  });

  it('switches to ?key=… query-string auth when geminiAuthMode is "query"', async () => {
    mockProvider.geminiAuthMode = 'query';
    const { captured } = mockGeminiResponse([
      frame({ candidates: [{ finishReason: 'STOP' }] })
    ]);
    await collect();
    const headers = captured[0]!.init?.headers as Record<string, string>;
    expect(headers['x-goog-api-key']).toBeUndefined();
    expect(captured[0]!.url).toContain('key=AIza-test');
    // alt=sse must still be present when the key joins the query
    expect(captured[0]!.url).toContain('alt=sse');
  });

  it('encodes the model id in the URL path (preview / dated suffixes)', async () => {
    const { captured } = mockGeminiResponse([
      frame({ candidates: [{ finishReason: 'STOP' }] })
    ]);
    for await (const _ of streamChat({
      providerId: 'p',
      model: 'gemini-3.1-pro-preview-2026-04',
      messages: []
    })) void _;
    expect(captured[0]!.url).toContain(
      '/v1beta/models/gemini-3.1-pro-preview-2026-04:streamGenerateContent'
    );
  });
});

// ────────────────────────────────────────────────────────────────────
// Body translation (toGeminiContents)
// ────────────────────────────────────────────────────────────────────

describe('toGeminiContents — body translation', () => {
  it('hoists a single system message into systemInstruction.parts[0].text', () => {
    const out = toGeminiContents([
      { role: 'system', content: 'You are V.' },
      { role: 'user', content: 'hi' }
    ]);
    expect(out.systemInstruction).toEqual({
      parts: [{ text: 'You are V.' }]
    });
    expect(out.contents).toEqual([
      { role: 'user', parts: [{ text: 'hi' }] }
    ]);
  });

  it('concatenates multiple system messages with a blank line', () => {
    const out = toGeminiContents([
      { role: 'system', content: 'You are V.' },
      { role: 'system', content: 'Be terse.' },
      { role: 'user', content: 'hi' }
    ]);
    expect(out.systemInstruction).toEqual({
      parts: [{ text: 'You are V.\n\nBe terse.' }]
    });
  });

  it('translates assistant tool_calls into model role + functionCall parts', () => {
    const out = toGeminiContents([
      { role: 'user', content: 'compute' },
      {
        role: 'assistant',
        content: 'one moment',
        tool_calls: [
          {
            id: 'gem_0',
            type: 'function',
            function: { name: 'calc', arguments: '{"x":1}' }
          }
        ]
      }
    ]);
    const assistant = out.contents[1]!;
    expect(assistant.role).toBe('model');
    expect(assistant.parts[0]).toEqual({ text: 'one moment' });
    expect(assistant.parts[1]).toEqual({
      functionCall: { name: 'calc', args: { x: 1 } }
    });
  });

  it('round-trips thoughtSignature on persisted tool_calls[i] back onto functionCall part', () => {
    const out = toGeminiContents([
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'gem_0',
            type: 'function',
            function: { name: 'calc', arguments: '{"x":1}' },
            thoughtSignature: 'OPAQUE_SIG'
          }
        ]
      }
    ]);
    const assistant = out.contents[0]!;
    expect(assistant.parts[0]).toEqual({
      functionCall: { name: 'calc', args: { x: 1 } },
      thoughtSignature: 'OPAQUE_SIG'
    });
  });

  it('translates tool messages into user role + functionResponse parts', () => {
    const out = toGeminiContents([
      {
        role: 'tool',
        content: '{"answer":42}',
        tool_call_id: 'gem_0',
        name: 'calc'
      }
    ]);
    expect(out.contents).toEqual([
      {
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: 'calc',
              response: { answer: 42 }
            }
          }
        ]
      }
    ]);
  });

  it('wraps non-JSON tool output into {result: "..."} for the functionResponse', () => {
    const out = toGeminiContents([
      {
        role: 'tool',
        content: 'plain text answer',
        tool_call_id: 'gem_0',
        name: 'echo'
      }
    ]);
    const part = out.contents[0]!.parts[0]!;
    expect(part.functionResponse).toEqual({
      name: 'echo',
      response: { result: 'plain text answer' }
    });
  });

  it('skips empty assistant turns (no content, no tool_calls)', () => {
    const out = toGeminiContents([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '' },
      { role: 'user', content: 'still there?' }
    ]);
    expect(out.contents).toHaveLength(2);
    expect(out.contents.every((c) => c.role === 'user')).toBe(true);
  });

  it('emits no systemInstruction when there are no system messages', () => {
    const out = toGeminiContents([{ role: 'user', content: 'hi' }]);
    expect(out.systemInstruction).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────
// toCanonicalUsage — normalization
// ────────────────────────────────────────────────────────────────────

describe('toCanonicalUsage — Gemini snake_case → camelCase', () => {
  it('maps every documented usage field', () => {
    const out = toCanonicalUsage({
      promptTokenCount: 100,
      candidatesTokenCount: 25,
      totalTokenCount: 125,
      thoughtsTokenCount: 80,
      cachedContentTokenCount: 60
    });
    expect(out).toEqual({
      promptTokens: 100,
      completionTokens: 25,
      totalTokens: 125,
      reasoningTokens: 80,
      cachedPromptTokens: 60
    });
  });

  it('omits cache + reasoning fields when not reported', () => {
    const out = toCanonicalUsage({
      promptTokenCount: 50,
      candidatesTokenCount: 10,
      totalTokenCount: 60
    });
    expect(out).toEqual({
      promptTokens: 50,
      completionTokens: 10,
      totalTokens: 60
    });
  });

  it('falls back to prompt+completion when totalTokenCount is missing', () => {
    const out = toCanonicalUsage({
      promptTokenCount: 7,
      candidatesTokenCount: 3
    });
    expect(out.totalTokens).toBe(10);
  });
});
