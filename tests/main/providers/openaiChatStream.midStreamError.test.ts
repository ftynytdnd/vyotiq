/**
 * OpenAI-compat mid-stream error envelope parity.
 *
 * The HTTP response is 200 and the stream opens, then the provider
 * emits a `data: {"error":{...}}` frame instead of content/usage
 * (OpenRouter upstream failures, mid-generation rate limits, Azure /
 * Together / Groq gateways). Before the parity fix this frame carried
 * no `choices` and no `usage`, so it was silently dropped and the run
 * finished with an empty assistant turn and no surfaced error. The
 * parser must now promote it to a `ProviderError`, mirroring the
 * Ollama transport — including the rate-limit sniff that feeds the
 * cooldown gate.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ChatStreamDelta } from '@main/providers/chatClient';
import { isProviderError } from '@main/providers/providerError';

vi.mock('@main/providers/providerStore', () => ({
  getProviderWithKey: vi.fn(async () => ({
    id: 'p',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api',
    dialect: 'openai',
    enabled: true,
    models: [],
    apiKey: 'sk-test'
  }))
}));

import { streamChat } from '@main/providers/chatClient';
import { _resetForTests as resetRateGuard } from '@main/providers/providerRateGuard';

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function buildBody(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encode(c));
      controller.close();
    }
  });
}

function mockOpenAiResponse(chunks: string[]): void {
  const mock = vi.fn(async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    body: buildBody(chunks)
  }));
  (globalThis as unknown as { fetch: typeof fetch }).fetch = mock as unknown as typeof fetch;
}

function sseFrame(payload: object): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

async function collectThrow(): Promise<{ deltas: ChatStreamDelta[]; err: unknown }> {
  const deltas: ChatStreamDelta[] = [];
  let err: unknown;
  try {
    for await (const d of streamChat({ providerId: 'p', model: 'gpt-5', messages: [] })) {
      deltas.push(d);
    }
  } catch (e) {
    err = e;
  }
  return { deltas, err };
}

beforeEach(() => {
  vi.resetModules();
  resetRateGuard();
});

describe('streamOpenAi — mid-stream error envelope', () => {
  it('promotes a canonical {error:{message}} frame to a server ProviderError', async () => {
    mockOpenAiResponse([
      sseFrame({ choices: [{ index: 0, delta: { content: 'partial' } }] }),
      sseFrame({ error: { message: 'upstream model crashed', type: 'server_error' } })
    ]);
    const { deltas, err } = await collectThrow();
    // Content that arrived before the error frame is still surfaced.
    expect(deltas.some((d) => d.contentDelta === 'partial')).toBe(true);
    expect(isProviderError(err)).toBe(true);
    if (isProviderError(err)) {
      expect(err.kind).toBe('server');
      expect(err.status).toBe(200);
      expect(err.friendlyMessage).toContain('upstream model crashed');
    }
  });

  it('classifies a rate-limit error frame as kind: rate-limit', async () => {
    mockOpenAiResponse([
      sseFrame({ error: { message: 'Rate limit exceeded, please slow down', code: 429 } })
    ]);
    const { err } = await collectThrow();
    expect(isProviderError(err)).toBe(true);
    if (isProviderError(err)) {
      expect(err.kind).toBe('rate-limit');
      expect(err.friendlyMessage).toMatch(/Rate limit exceeded \(mid-stream\)/);
    }
  });

  it('handles a bare-string error envelope', async () => {
    mockOpenAiResponse([sseFrame({ error: 'something went wrong' })]);
    const { err } = await collectThrow();
    expect(isProviderError(err)).toBe(true);
    if (isProviderError(err)) {
      expect(err.friendlyMessage).toContain('something went wrong');
    }
  });

  it('surfaces OpenRouter metadata when the top-level message is generic', async () => {
    mockOpenAiResponse([
      sseFrame({
        error: {
          message: 'Provider returned error',
          metadata: { reason: 'Upstream idle timeout exceeded' }
        }
      })
    ]);
    const { err } = await collectThrow();
    expect(isProviderError(err)).toBe(true);
    if (isProviderError(err)) {
      expect(err.friendlyMessage).toContain('Upstream idle timeout exceeded');
      expect(err.friendlyMessage).not.toMatch(/Provider returned error — Provider returned error/);
    }
  });
});
