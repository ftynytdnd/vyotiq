/**
 * `streamChat` over the Ollama-native dialect — NDJSON parsing
 * regression suite.
 *
 * Locks the contract that the orchestrator loop above (runLoop /
 * consumeChatStream / handleAssistantTurn) sees an IDENTICAL
 * `ChatStreamDelta` shape regardless of dialect: dialect-specific
 * differences (NDJSON framing, `message.thinking`, complete-frame
 * tool calls, `eval_count`/`prompt_eval_count` usage) MUST be
 * flattened inside `ollamaChatStream.ts` so nothing downstream
 * branches on dialect.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ChatStreamDelta } from '@main/providers/chatClient';

vi.mock('@main/providers/providerStore', () => ({
  getProviderWithKey: vi.fn(async () => ({
    id: 'p',
    name: 'Ollama Cloud',
    baseUrl: 'https://ollama.com',
    dialect: 'ollama-native',
    enabled: true,
    models: [],
    apiKey: 'k-test'
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

function mockOllamaResponse(chunks: string[]): void {
  const mock = vi.fn(async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    body: buildBody(chunks)
  }));
  (globalThis as unknown as { fetch: typeof fetch }).fetch = mock as unknown as typeof fetch;
}

async function collect(): Promise<ChatStreamDelta[]> {
  const out: ChatStreamDelta[] = [];
  for await (const d of streamChat({ providerId: 'p', model: 'gpt-oss:120b', messages: [] }))
    out.push(d);
  return out;
}

beforeEach(() => {
  vi.resetModules();
  // The rate guard is a process-singleton — any test that triggers
  // `markRateLimited` (the mid-stream rate-limit detection cases, the
  // HTTP-429 initial-rejection case) leaks a cooldown into the next
  // test which then sleeps in `acquire(providerId)` before issuing
  // its fetch. Reset between tests to keep cases independent and the
  // suite snappy.
  resetRateGuard();
});

describe('streamChat (Ollama native) — NDJSON parsing', () => {
  it('yields content deltas across multiple frames', async () => {
    mockOllamaResponse([
      JSON.stringify({ message: { role: 'assistant', content: 'Hello' }, done: false }) + '\n',
      JSON.stringify({ message: { role: 'assistant', content: ' world' }, done: false }) + '\n',
      JSON.stringify({
        message: { role: 'assistant', content: '' },
        done: true,
        done_reason: 'stop',
        prompt_eval_count: 4,
        eval_count: 7
      }) + '\n'
    ]);
    const deltas = await collect();
    expect(deltas.map((d) => d.contentDelta ?? '').join('')).toBe('Hello world');
  });

  it('flattens message.thinking into reasoningDelta', async () => {
    mockOllamaResponse([
      JSON.stringify({ message: { thinking: 'Let me think…' }, done: false }) + '\n',
      JSON.stringify({ message: { content: 'Answer.' }, done: false }) + '\n',
      JSON.stringify({
        message: { content: '' },
        done: true,
        done_reason: 'stop',
        prompt_eval_count: 1,
        eval_count: 1
      }) + '\n'
    ]);
    const deltas = await collect();
    expect(deltas[0]?.reasoningDelta).toBe('Let me think…');
    expect(deltas[1]?.contentDelta).toBe('Answer.');
  });

  it('synthesizes toolCallDelta with id/index/argumentsDelta from a single frame', async () => {
    mockOllamaResponse([
      JSON.stringify({
        message: {
          tool_calls: [
            { function: { name: 'get_weather', arguments: { city: 'Tokyo' } } }
          ]
        },
        done: false
      }) + '\n',
      JSON.stringify({
        message: { content: '' },
        done: true,
        done_reason: 'stop',
        prompt_eval_count: 1,
        eval_count: 1
      }) + '\n'
    ]);
    const deltas = await collect();
    const tc = deltas.find((d) => d.toolCallDelta)?.toolCallDelta;
    expect(tc?.index).toBe(0);
    expect(tc?.id).toMatch(/^ol-/);
    expect(tc?.name).toBe('get_weather');
    // Arguments arrive as an OBJECT in the wire format; we re-stringify
    // so consumeChatStream's argumentsBuf accumulator stays valid JSON.
    expect(JSON.parse(tc?.argumentsDelta ?? '{}')).toEqual({ city: 'Tokyo' });
  });

  /**
   * Regression: GLM-4.7 (and other Ollama-Cloud parallel-tool models)
   * stream parallel tool calls across MULTIPLE NDJSON frames, each
   * carrying its own `tool_calls: [{...}]` of length 1. The previous
   * implementation used the per-frame array index `i` for
   * `toolCallDelta.index`, so the second call arrived with `index: 0`
   * and `consumeChatStream` concatenated its arguments into the first
   * call's `argumentsBuf` — `parseToolArgs` then failed with
   * "Unexpected non-whitespace character after JSON" and the run hit
   * the 3-strike halt. The fix is a stream-local cumulative counter
   * so each tool call gets its own slot regardless of how the
   * provider chunked them.
   *
   * Pinned shape: two frames, one tool call each, indices 0 and 1
   * respectively, distinct synthesized ids.
   */
  it('assigns CUMULATIVE indices to parallel tool calls split across multiple frames', async () => {
    mockOllamaResponse([
      JSON.stringify({
        message: {
          tool_calls: [
            {
              function: {
                name: 'memory',
                arguments: { action: 'list', scope: 'global' }
              }
            }
          ]
        },
        done: false
      }) + '\n',
      JSON.stringify({
        message: {
          tool_calls: [
            {
              function: {
                name: 'memory',
                arguments: { action: 'list', scope: 'workspace' }
              }
            }
          ]
        },
        done: false
      }) + '\n',
      JSON.stringify({
        message: { content: '' },
        done: true,
        done_reason: 'stop'
      }) + '\n'
    ]);
    const deltas = await collect();
    const toolDeltas = deltas
      .map((d) => d.toolCallDelta)
      .filter((tc): tc is NonNullable<typeof tc> => Boolean(tc));
    expect(toolDeltas).toHaveLength(2);
    // First call → index 0
    expect(toolDeltas[0]?.index).toBe(0);
    expect(toolDeltas[0]?.id).toMatch(/^ol-/);
    expect(JSON.parse(toolDeltas[0]?.argumentsDelta ?? '{}')).toEqual({
      action: 'list',
      scope: 'global'
    });
    // Second call → index 1 (NOT 0). This is the regression assertion.
    expect(toolDeltas[1]?.index).toBe(1);
    expect(toolDeltas[1]?.id).not.toBe(toolDeltas[0]?.id);
    expect(JSON.parse(toolDeltas[1]?.argumentsDelta ?? '{}')).toEqual({
      action: 'list',
      scope: 'workspace'
    });
  });

  /**
   * Companion case: parallel tool calls within a SINGLE frame's
   * `tool_calls` array also each receive their own cumulative
   * index. Prior behavior used per-frame `i` here so they were
   * already at 0,1 — but after the fix this case relies on the
   * SAME cumulative counter, so we pin it explicitly to guard
   * against a future refactor mixing the two paths.
   */
  it('assigns cumulative indices to multiple tool calls within a single frame', async () => {
    mockOllamaResponse([
      JSON.stringify({
        message: {
          tool_calls: [
            { function: { name: 'ls', arguments: { path: 'src' } } },
            { function: { name: 'ls', arguments: { path: 'tests' } } }
          ]
        },
        done: false
      }) + '\n',
      JSON.stringify({
        message: { content: '' },
        done: true,
        done_reason: 'stop'
      }) + '\n'
    ]);
    const deltas = await collect();
    const toolDeltas = deltas
      .map((d) => d.toolCallDelta)
      .filter((tc): tc is NonNullable<typeof tc> => Boolean(tc));
    expect(toolDeltas).toHaveLength(2);
    expect(toolDeltas[0]?.index).toBe(0);
    expect(toolDeltas[1]?.index).toBe(1);
    expect(toolDeltas[0]?.id).not.toBe(toolDeltas[1]?.id);
  });

  it('passes through arguments delivered as a JSON-encoded string without re-stringifying', async () => {
    // Regression: some Ollama Cloud builds / upstream proxies deliver
    // `tool_calls[].function.arguments` as a STRING rather than the
    // documented OBJECT. The previous implementation called
    // `JSON.stringify` unconditionally, producing a doubly-quoted
    // scalar that parsed back to a string and silently dropped the
    // argument record — surfacing as misleading "missing <param>"
    // errors at the executor (e.g. `read` failing with "missing path"
    // even though the model emitted `{"path":"src/index.ts"}`).
    mockOllamaResponse([
      JSON.stringify({
        message: {
          tool_calls: [
            {
              function: {
                name: 'read',
                arguments: '{"path":"src/index.ts"}'
              }
            }
          ]
        },
        done: false
      }) + '\n',
      JSON.stringify({
        message: { content: '' },
        done: true,
        done_reason: 'stop'
      }) + '\n'
    ]);
    const deltas = await collect();
    const tc = deltas.find((d) => d.toolCallDelta)?.toolCallDelta;
    expect(JSON.parse(tc?.argumentsDelta ?? '{}')).toEqual({ path: 'src/index.ts' });
  });

  it('emits a synthetic usage frame from prompt_eval_count + eval_count', async () => {
    mockOllamaResponse([
      JSON.stringify({ message: { content: 'hi' }, done: false }) + '\n',
      JSON.stringify({
        message: { content: '' },
        done: true,
        done_reason: 'stop',
        prompt_eval_count: 12,
        eval_count: 5
      }) + '\n'
    ]);
    const deltas = await collect();
    const usage = deltas.find((d) => d.usage)?.usage;
    expect(usage).toEqual({ promptTokens: 12, completionTokens: 5, totalTokens: 17 });
    const finish = deltas.find((d) => d.finishReason)?.finishReason;
    expect(finish).toBe('stop');
  });

  it('handles a frame split across multiple network chunks', async () => {
    mockOllamaResponse([
      '{"message":{"content":"par',
      'tial"},"done":false}\n',
      JSON.stringify({
        message: { content: '' },
        done: true,
        done_reason: 'stop'
      }) + '\n'
    ]);
    const deltas = await collect();
    expect(deltas.map((d) => d.contentDelta ?? '').join('')).toBe('partial');
  });

  it('skips malformed lines and keeps streaming', async () => {
    mockOllamaResponse([
      'not-json-at-all\n',
      JSON.stringify({ message: { content: 'ok' }, done: false }) + '\n',
      JSON.stringify({ message: { content: '' }, done: true }) + '\n'
    ]);
    const deltas = await collect();
    expect(deltas.map((d) => d.contentDelta ?? '').join('')).toBe('ok');
  });

  it('falls back to "stop" when done_reason is absent', async () => {
    mockOllamaResponse([
      JSON.stringify({ message: { content: 'hi' }, done: false }) + '\n',
      JSON.stringify({ message: { content: '' }, done: true }) + '\n'
    ]);
    const deltas = await collect();
    expect(deltas.find((d) => d.finishReason)?.finishReason).toBe('stop');
  });
});

describe('streamChat (Ollama native) — error classification', () => {
  it('throws ProviderError(billing) on 402', async () => {
    const mock = vi.fn(async () => ({
      ok: false,
      status: 402,
      statusText: 'Payment Required',
      body: buildBody(['{"error":{"message":"Insufficient Balance"}}'])
    }));
    (globalThis as unknown as { fetch: typeof fetch }).fetch = mock as unknown as typeof fetch;

    await expect(collect()).rejects.toMatchObject({
      name: 'ProviderError',
      kind: 'billing',
      status: 402
    });
  });

  it('throws ProviderError on a mid-stream {"error":"..."} NDJSON frame', async () => {
    // Regression: Ollama emits `{"error":"..."}` as its own NDJSON line
    // when the model fails AFTER the stream began (context length
    // overflow, cloud-side model crash, etc.). Before this fix the
    // parser saw no `message` / `done` / `tool_calls`, yielded nothing,
    // and the generator closed cleanly — the user saw a stuck spinner
    // that silently finished with an empty response and no retry.
    mockOllamaResponse([
      JSON.stringify({ message: { content: 'partial' }, done: false }) + '\n',
      '{"error":"context length exceeded"}\n'
    ]);
    await expect(collect()).rejects.toMatchObject({
      name: 'ProviderError',
      kind: 'server',
      friendlyMessage: expect.stringContaining('context length exceeded')
    });
  });

  it('throws ProviderError on a mid-stream {"error":{message}} envelope', async () => {
    // Some Ollama builds / upstreams use the nested form seen on OpenAI.
    mockOllamaResponse([
      JSON.stringify({ message: { content: 'partial' }, done: false }) + '\n',
      JSON.stringify({ error: { message: 'backend oom' } }) + '\n'
    ]);
    await expect(collect()).rejects.toMatchObject({
      name: 'ProviderError',
      kind: 'server',
      friendlyMessage: expect.stringContaining('backend oom')
    });
  });

  /**
   * Audit A-17 regression: Ollama Cloud emits saturation errors as a
   * mid-stream `{"error":"too many concurrent requests"}` envelope
   * AFTER the HTTP response was already 200. The initial-rejection
   * branch (which feeds the rate guard on 429/5xx) never runs for
   * these — without explicit detection on the body the sub-agent
   * pool's siblings would dog-pile on retry. The fix classifies the
   * error as `kind: 'rate-limit'` AND calls `markRateLimited` so
   * the per-provider cooldown applies.
   *
   * We assert the structural ProviderError shape here; the
   * `markRateLimited` side-effect is covered by the rate-guard's
   * own unit suite (it's a process-singleton clearing on every
   * test setup elsewhere) — verifying both `kind` flip and the
   * friendly-message prefix is a sufficient signal that the
   * detection branch ran.
   */
  it('classifies mid-stream "too many concurrent requests" as rate-limit', async () => {
    mockOllamaResponse([
      JSON.stringify({ message: { content: 'partial' }, done: false }) + '\n',
      '{"error":"too many concurrent requests"}\n'
    ]);
    await expect(collect()).rejects.toMatchObject({
      name: 'ProviderError',
      kind: 'rate-limit',
      status: 200,
      friendlyMessage: expect.stringContaining('Rate limit exceeded')
    });
  });

  it('classifies mid-stream "rate limit exceeded" (nested form) as rate-limit', async () => {
    mockOllamaResponse([
      JSON.stringify({ message: { content: 'partial' }, done: false }) + '\n',
      JSON.stringify({ error: { message: 'You have hit the rate limit. Retry later.' } }) + '\n'
    ]);
    await expect(collect()).rejects.toMatchObject({
      name: 'ProviderError',
      kind: 'rate-limit',
      status: 200
    });
  });

  it('keeps kind=server for non-rate-limit mid-stream errors (no false positives)', async () => {
    // Sanity guard: a generic backend failure must NOT be promoted to
    // 'rate-limit' just because it shares one of the matched roots
    // outside a word boundary. "concurrency" / "concurrent" by itself
    // (not paired with "requests"/"connections") would also be a
    // false positive — kept under deliberate non-match here.
    mockOllamaResponse([
      JSON.stringify({ message: { content: 'partial' }, done: false }) + '\n',
      JSON.stringify({ error: 'model crashed: segfault in worker' }) + '\n'
    ]);
    await expect(collect()).rejects.toMatchObject({
      name: 'ProviderError',
      kind: 'server',
      status: 200
    });
  });

  it('surfaces the response body in friendlyMessage on 400 (diagnostic)', async () => {
    // Ollama Cloud's 400 body is the ONLY useful bit of information
    // for "your request is malformed" failures. Before this was wired
    // up the user saw a bare `HTTP 400 Bad Request` with no actionable
    // context. Regression: the friendlyMessage should now include the
    // provider's own error text.
    //
    // NOTE: real `fetch` Response objects expose BOTH `.body`
    // (ReadableStream) and `.text()` (drains the body). Our error-path
    // code uses `.text()` via `safeText`, so a mock that only provides
    // `.body` would silently return empty and mask the assertion.
    const errJson = '{"error":"model \\"nope:0.1\\" not found, try pulling it first"}';
    const mock = vi.fn(async () => ({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      body: buildBody([errJson]),
      text: async () => errJson
    }));
    (globalThis as unknown as { fetch: typeof fetch }).fetch = mock as unknown as typeof fetch;

    await expect(collect()).rejects.toMatchObject({
      name: 'ProviderError',
      kind: 'unknown',
      status: 400,
      friendlyMessage: expect.stringContaining('model "nope:0.1" not found')
    });
  });
});

describe('streamChat (Ollama native) — request-body translation', () => {
  /**
   * Capture what's actually sent on the wire. The translator is the
   * whole point of this fix: an un-translated OpenAI-shaped
   * ChatMessage array 400s Ollama Cloud any time a prior tool-call
   * turn is echoed back.
   */
  async function captureRequestBody(messages: unknown): Promise<Record<string, unknown>> {
    let captured: Record<string, unknown> = {};
    const mock = vi.fn(async (_url: string, init: RequestInit) => {
      captured = JSON.parse(init.body as string) as Record<string, unknown>;
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        body: buildBody([
          JSON.stringify({ message: { content: '' }, done: true, done_reason: 'stop' }) + '\n'
        ])
      };
    });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = mock as unknown as typeof fetch;
    // Drain the generator so the fetch actually runs.
    const iter = streamChat({
      providerId: 'p',
      model: 'gpt-oss:120b',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: messages as any
    });
    for await (const _ of iter) void _;
    return captured;
  }

  it('rewrites content:null to "" on assistant tool-call turns', async () => {
    // OpenAI permits `content: null` for an assistant turn that only
    // carries tool_calls. Ollama rejects the null.
    const body = await captureRequestBody([
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'ls', arguments: '{"path":"."}' }
          }
        ]
      }
    ]);
    const msgs = body['messages'] as Array<Record<string, unknown>>;
    expect(msgs[0]?.['content']).toBe('');
    expect(msgs[0]).not.toHaveProperty('tool_call_id');
  });

  it('parses tool-call arguments string into an object', async () => {
    const body = await captureRequestBody([
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'ls', arguments: '{"path":"src","recursive":true}' }
          }
        ]
      }
    ]);
    const msgs = body['messages'] as Array<Record<string, unknown>>;
    const toolCalls = msgs[0]?.['tool_calls'] as Array<Record<string, unknown>>;
    const fn = toolCalls[0]?.['function'] as Record<string, unknown>;
    expect(fn['arguments']).toEqual({ path: 'src', recursive: true });
    // The OpenAI-only `id` + `type` fields must be dropped.
    expect(toolCalls[0]).not.toHaveProperty('id');
    expect(toolCalls[0]).not.toHaveProperty('type');
  });

  it('falls back to {} when a tool-call arguments string is malformed', async () => {
    // Regression: we must NOT propagate a JSON.parse exception out of
    // the translator — doing so would turn a recoverable "model emitted
    // broken JSON" into a 3-strike retry storm.
    const body = await captureRequestBody([
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'x', type: 'function', function: { name: 'ls', arguments: '{not-json' } }
        ]
      }
    ]);
    const msgs = body['messages'] as Array<Record<string, unknown>>;
    const toolCalls = msgs[0]?.['tool_calls'] as Array<Record<string, unknown>>;
    const fn = toolCalls[0]?.['function'] as Record<string, unknown>;
    expect(fn['arguments']).toEqual({});
  });

  it('maps ChatMessage.name → tool_name on role:tool messages', async () => {
    const body = await captureRequestBody([
      {
        role: 'tool',
        content: 'ok',
        tool_call_id: 'call_1',
        name: 'ls'
      }
    ]);
    const msgs = body['messages'] as Array<Record<string, unknown>>;
    expect(msgs[0]?.['tool_name']).toBe('ls');
    // `tool_call_id` is OpenAI-only and must not cross the wire.
    expect(msgs[0]).not.toHaveProperty('tool_call_id');
    // `name` (the OpenAI field) should also not appear.
    expect(msgs[0]).not.toHaveProperty('name');
  });

  it('does not send options.num_ctx (was silently truncating prompts)', async () => {
    // Regression: an earlier version mapped maxTokens → num_ctx which
    // 400'd Ollama Cloud when the prompt exceeded the cap. We now map
    // maxTokens → num_predict (output cap); num_ctx stays at the
    // model's default unless a caller explicitly needs to override it.
    let captured: Record<string, unknown> = {};
    const mock = vi.fn(async (_url: string, init: RequestInit) => {
      captured = JSON.parse(init.body as string) as Record<string, unknown>;
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        body: buildBody([
          JSON.stringify({ message: { content: '' }, done: true }) + '\n'
        ])
      };
    });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = mock as unknown as typeof fetch;
    const iter = streamChat({
      providerId: 'p',
      model: 'gpt-oss:120b',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 512
    });
    for await (const _ of iter) void _;
    const options = (captured['options'] as Record<string, unknown>) ?? {};
    expect(options).not.toHaveProperty('num_ctx');
    expect(options['num_predict']).toBe(512);
  });
});
