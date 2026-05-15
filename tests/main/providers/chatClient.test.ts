/**
 * `streamChat` SSE frame parser tests.
 *
 * Regression for the CRLF separator bug: several Windows-hosted
 * OpenAI-compat providers (LM Studio, some vLLM builds) terminate SSE
 * frames with `\r\n\r\n` instead of `\n\n`. The older parser's
 * `indexOf('\n\n')` never matched, the buffer grew forever, and no
 * deltas reached the caller — symptomatically the run hung until the
 * user aborted. We normalize CRLF → LF at the byte boundary, so both
 * flavours MUST produce identical delta streams.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ChatStreamDelta } from '@main/providers/chatClient';

vi.mock('@main/providers/providerStore', () => ({
  getProviderWithKey: vi.fn(async () => ({
    id: 'p',
    name: 'mock',
    kind: 'openai',
    baseUrl: 'https://example.invalid',
    models: [],
    apiKey: undefined
  }))
}));

import { streamChat } from '@main/providers/chatClient';

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/**
 * Build a minimal `ReadableStream` that yields the given chunks in
 * order then closes. Matches the shape `fetch().body` produces so
 * `getReader()` / `read()` work the same way.
 */
function buildBody(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encode(c));
      controller.close();
    }
  });
}

function mockFetchOnce(chunks: string[]): void {
  const mock = vi.fn(async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    body: buildBody(chunks)
  }));
  (globalThis as unknown as { fetch: typeof fetch }).fetch = mock as unknown as typeof fetch;
}

async function collect(req: Parameters<typeof streamChat>[0]): Promise<ChatStreamDelta[]> {
  const out: ChatStreamDelta[] = [];
  for await (const d of streamChat(req)) out.push(d);
  return out;
}

// `as const` is intentionally omitted: it makes `messages: []` widen
// to `readonly []`, which then fails the `ChatStreamRequest.messages:
// ChatMessage[]` assignability check (mutable array required). The
// runtime behavior is identical either way — every `streamChat` call
// site reads `messages` without mutating it — but the TS surface is
// stricter, so we keep the literal mutable here.
const baseReq: import('@main/providers/chatClient').ChatStreamRequest = {
  providerId: 'p',
  model: 'm',
  messages: []
};

beforeEach(() => {
  vi.resetModules();
});

describe('streamChat — SSE frame parsing', () => {
  it('yields deltas when frames are LF/LF-separated (baseline)', async () => {
    mockFetchOnce([
      'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
      'data: [DONE]\n\n'
    ]);
    const deltas = await collect(baseReq);
    const text = deltas.map((d) => d.contentDelta ?? '').join('');
    expect(text).toBe('hello world');
  });

  it('yields identical deltas when frames are CRLF/CRLF-separated', async () => {
    // The critical regression. Before the CRLF normalization fix the
    // buffer accumulated forever here and `deltas` came back empty.
    mockFetchOnce([
      'data: {"choices":[{"delta":{"content":"hello"}}]}\r\n\r\n',
      'data: {"choices":[{"delta":{"content":" world"}}]}\r\n\r\n',
      'data: [DONE]\r\n\r\n'
    ]);
    const deltas = await collect(baseReq);
    const text = deltas.map((d) => d.contentDelta ?? '').join('');
    expect(text).toBe('hello world');
  });

  it('tolerates mixed CRLF and LF frames in the same stream', async () => {
    mockFetchOnce([
      'data: {"choices":[{"delta":{"content":"a"}}]}\r\n\r\n' +
      'data: {"choices":[{"delta":{"content":"b"}}]}\n\n',
      'data: [DONE]\n\n'
    ]);
    const deltas = await collect(baseReq);
    expect(deltas.map((d) => d.contentDelta ?? '').join('')).toBe('ab');
  });

  it('splits a frame delivered across multiple chunks', async () => {
    // The reader boundary may land mid-frame; the internal buffer must
    // accumulate until the separator arrives.
    mockFetchOnce([
      'data: {"choices":[{"delta":{"content":"par',
      'tial"}}]}\r\n',
      '\r\ndata: [DONE]\n\n'
    ]);
    const deltas = await collect(baseReq);
    expect(deltas.map((d) => d.contentDelta ?? '').join('')).toBe('partial');
  });

  it('emits the final usage frame when present', async () => {
    mockFetchOnce([
      'data: {"choices":[{"delta":{"content":"hi"}}]}\r\n\r\n',
      'data: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}\r\n\r\n',
      'data: [DONE]\r\n\r\n'
    ]);
    const deltas = await collect(baseReq);
    const usage = deltas.find((d) => d.usage);
    expect(usage?.usage).toEqual({ promptTokens: 3, completionTokens: 2, totalTokens: 5 });
  });

  it('flushes the final frame when the stream closes without a trailing separator', async () => {
    // Regression for audit finding 2.3: a dropped connection mid-frame
    // (or any server that closes its body without a final `\n\n`) used
    // to silently strip the last `data:` line — including the usage
    // payload that drives the UI's token-count telemetry. Post-fix the
    // reader's `done` branch drains the decoder and passes the tail
    // through the same frame parser as the hot loop.
    mockFetchOnce([
      'data: {"choices":[{"delta":{"content":"tail"}}]}\r\n\r\n' +
      // NOTE: NO trailing `\r\n\r\n` on the last frame. Also no
      // `[DONE]` marker. The stream just closes.
      'data: {"choices":[],"usage":{"prompt_tokens":9,"completion_tokens":4,"total_tokens":13}}'
    ]);
    const deltas = await collect(baseReq);
    const text = deltas.map((d) => d.contentDelta ?? '').join('');
    expect(text).toBe('tail');
    const usage = deltas.find((d) => d.usage);
    expect(usage?.usage).toEqual({
      promptTokens: 9,
      completionTokens: 4,
      totalTokens: 13
    });
  });

  it('forwards tool_choice even when the tools array is empty (wrap-up turn)', async () => {
    // Regression: SubAgent's wrap-up path sends
    //   { tools: [], toolChoice: 'none' }
    // to force the model to emit prose instead of calling more tools.
    // The old guard (`tools.length > 0`) stripped the `tool_choice`
    // field on the way out, so the wrap-up nudge never reached the
    // provider and sub-agents often kept tool-calling right up to
    // the 16-turn cap. Post-fix the field is forwarded whenever the
    // caller sets it, independent of `tools`.
    let captured: Record<string, unknown> = {};
    const mock = vi.fn(async (_url: string | URL | Request, init: RequestInit) => {
      captured = JSON.parse(init.body as string) as Record<string, unknown>;
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        body: buildBody(['data: [DONE]\n\n'])
      };
    });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = mock as unknown as typeof fetch;
    const iter = streamChat({
      providerId: 'p',
      model: 'm',
      messages: [{ role: 'user', content: 'finish up' }],
      toolChoice: 'none'
    });
    for await (const _ of iter) void _;
    expect(captured['tool_choice']).toBe('none');
    // `tools` must NOT be injected when the caller didn't provide one;
    // some strict providers reject an empty `tools: []`.
    expect(captured).not.toHaveProperty('tools');
  });

  it('drains MULTIPLE pending frames from the final buffer at EOF', async () => {
    // Regression for the "single-flush-only" bug. The old code ran
    // `parseFrame(tail)` once on whatever remained in the buffer;
    // `parseFrame` matches the FIRST `data:` line in the input. So a
    // buffer holding `data: {chunk}\n\ndata: {usage}` (two complete
    // frames queued, no trailing separator) yielded only the content
    // delta and silently dropped the usage frame. Post-fix the final-
    // flush runs the same `indexOf('\n\n')` loop as the hot path, then
    // parses any residual single-frame tail.
    mockFetchOnce([
      // Two full frames separated by `\r\n\r\n`, BUT no trailing
      // separator after the usage frame — exactly what an early-close
      // between frame boundaries produces.
      'data: {"choices":[{"delta":{"content":"last"}}]}\r\n\r\n' +
      'data: {"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":3,"total_tokens":10}}\r\n\r\n' +
      'data: {"choices":[{"finish_reason":"stop"}]}'
    ]);
    const deltas = await collect(baseReq);
    expect(deltas.map((d) => d.contentDelta ?? '').join('')).toBe('last');
    const usage = deltas.find((d) => d.usage)?.usage;
    expect(usage).toEqual({ promptTokens: 7, completionTokens: 3, totalTokens: 10 });
    const finish = deltas.find((d) => d.finishReason)?.finishReason;
    expect(finish).toBe('stop');
  });
});
