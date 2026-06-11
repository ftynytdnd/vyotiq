import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { streamChat } from '@main/providers/chatClient';
import { _resetForTests as resetRateGuard } from '@main/providers/providerRateGuard';

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

describe('anthropic cache diagnostics on wire', () => {
  const prevDiag = process.env['VYOTIQ_CACHE_DIAGNOSTICS'];

  beforeEach(() => {
    resetRateGuard();
    vi.restoreAllMocks();
    process.env['VYOTIQ_CACHE_DIAGNOSTICS'] = '1';
  });

  afterEach(() => {
    if (prevDiag === undefined) delete process.env['VYOTIQ_CACHE_DIAGNOSTICS'];
    else process.env['VYOTIQ_CACHE_DIAGNOSTICS'] = prevDiag;
  });

  it('sends diagnostics beta header and previous_message_id', async () => {
    let capturedHeaders: Record<string, string> | null = null;
    let capturedBody: Record<string, unknown> | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        capturedHeaders = Object.fromEntries(new Headers(init?.headers).entries());
        capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        const sse =
          'event: message_start\n' +
          'data: {"type":"message_start","message":{"id":"msg_test","usage":{"input_tokens":1,"output_tokens":0}}}\n\n' +
          'event: message_stop\n' +
          'data: {"type":"message_stop"}\n\n';
        return new Response(sse, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' }
        });
      })
    );

    for await (const _ of streamChat({
      providerId: 'p',
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'hi' }],
      workspaceId: 'ws-1',
      previousAnthropicMessageId: 'msg_prev'
    })) {
      /* drain */
    }

    expect(capturedHeaders?.['anthropic-beta']).toContain('cache-diagnosis-2026-04-07');
    expect(capturedBody?.['metadata']).toEqual({ user_id: 'ws-1' });
    expect(capturedBody?.['diagnostics']).toEqual({ previous_message_id: 'msg_prev' });
  });
});
