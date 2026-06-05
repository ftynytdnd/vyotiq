import { describe, expect, it } from 'vitest';
import {
  resolveOpenAiTransport,
  shouldFallbackResponsesToChatCompletions
} from '@shared/providers/openaiTransport.js';

describe('resolveOpenAiTransport', () => {
  it('uses chat-completions for third-party hosts', () => {
    expect(
      resolveOpenAiTransport(
        { baseUrl: 'https://openrouter.ai/api', openaiTransport: 'auto' },
        'gpt-5.3'
      )
    ).toBe('chat-completions');
  });

  it('auto-selects responses for official OpenAI when discovery marks reasoning', () => {
    expect(
      resolveOpenAiTransport(
        {
          baseUrl: 'https://api.openai.com',
          openaiTransport: 'auto',
          models: [
            {
              id: 'gpt-5.3',
              thinking: { supported: true, wireStyle: 'openai-reasoning' }
            }
          ]
        },
        'gpt-5.3'
      )
    ).toBe('responses');
  });

  it('stays on chat-completions for official OpenAI without discovery metadata', () => {
    expect(
      resolveOpenAiTransport(
        { baseUrl: 'https://api.openai.com', openaiTransport: 'auto', models: [{ id: 'gpt-5.3' }] },
        'gpt-5.3'
      )
    ).toBe('chat-completions');
  });

  it('honors explicit transport override', () => {
    expect(
      resolveOpenAiTransport(
        { baseUrl: 'https://api.openai.com', openaiTransport: 'chat-completions' },
        'gpt-5.3'
      )
    ).toBe('chat-completions');
  });
});

describe('shouldFallbackResponsesToChatCompletions', () => {
  it('allows fallback on 404 unless locked to responses', () => {
    expect(shouldFallbackResponsesToChatCompletions(404, false)).toBe(true);
    expect(shouldFallbackResponsesToChatCompletions(404, true)).toBe(false);
  });
});
