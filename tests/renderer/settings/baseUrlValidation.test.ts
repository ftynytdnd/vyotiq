/**
 * Lock the base-URL validator's contract. The rules MUST stay in sync
 * with the runtime fetchers in `src/main/providers/modelDiscovery.ts`
 * and `src/main/providers/{openai,ollama}ChatStream.ts` — drift means
 * the form says "looks good" while the chat client refuses at runtime.
 */

import { describe, expect, it } from 'vitest';
import { describeBaseUrl } from '@renderer/components/settings/baseUrlValidation';

describe('describeBaseUrl', () => {
  it('errors on empty input', () => {
    const r = describeBaseUrl('   ', 'openai');
    expect(r?.severity).toBe('error');
    expect(r?.message).toMatch(/required/i);
  });

  it('errors on a string that is not a URL', () => {
    const r = describeBaseUrl('not a url', 'openai');
    expect(r?.severity).toBe('error');
    expect(r?.message).toMatch(/not a valid URL/);
  });

  it('errors on file:// schemes', () => {
    const r = describeBaseUrl('file:///etc/passwd', 'openai');
    expect(r?.severity).toBe('error');
    expect(r?.message).toMatch(/http/);
  });

  it('passes through a clean OpenAI base URL with no message', () => {
    expect(describeBaseUrl('https://api.openai.com', 'openai')).toBeNull();
  });

  it('passes through localhost Ollama (openai dialect via shim)', () => {
    expect(describeBaseUrl('http://localhost:11434', 'openai')).toBeNull();
  });

  it('warns when ollama.com is paired with the OpenAI dialect', () => {
    const r = describeBaseUrl('https://ollama.com', 'openai');
    expect(r?.severity).toBe('warn');
    expect(r?.message).toMatch(/Ollama Cloud|Ollama native/i);
  });

  it('passes through ollama.com when the dialect is ollama-native', () => {
    expect(describeBaseUrl('https://ollama.com', 'ollama-native')).toBeNull();
  });

  it('warns when ollama-native is paired with a non-Ollama remote host', () => {
    const r = describeBaseUrl('https://api.openai.com', 'ollama-native');
    expect(r?.severity).toBe('warn');
    expect(r?.message).toMatch(/native dialect/i);
  });

  it('strips a trailing /v1 silently and reports info', () => {
    const r = describeBaseUrl('https://api.example.com/v1', 'openai');
    expect(r?.severity).toBe('info');
    expect(r?.normalized).toBe('https://api.example.com');
    expect(r?.message).toMatch(/Stripped trailing/);
  });

  it('also strips a trailing /v1/ (with slash)', () => {
    const r = describeBaseUrl('https://api.example.com/v1/', 'openai');
    expect(r?.severity).toBe('info');
    expect(r?.normalized).toBe('https://api.example.com');
  });

  it('strips a trailing /api on ollama-native (the Ollama-Cloud-docs footgun)', () => {
    // Regression: a user pasting `https://ollama.com/api` (lifted
    // straight from the Ollama Cloud docs) used to make the chat
    // client hit `https://ollama.com/api/api/chat` and the discovery
    // path hit `https://ollama.com/api/v1/models` — both 404.
    const r = describeBaseUrl('https://ollama.com/api', 'ollama-native');
    expect(r?.severity).toBe('info');
    expect(r?.normalized).toBe('https://ollama.com');
    expect(r?.message).toMatch(/Stripped trailing \/api/);
  });

  it('PRESERVES a trailing /api on the openai dialect (OpenRouter regression)', () => {
    // OpenRouter's canonical base is `https://openrouter.ai/api`.
    // The chat client appends `/v1/chat/completions`, giving the
    // correct `https://openrouter.ai/api/v1/chat/completions`. Under
    // the OpenAI dialect we therefore must NOT strip the trailing
    // `/api`. (The earlier dialect-blind rule did, which 404'd every
    // OpenRouter call.)
    expect(describeBaseUrl('https://openrouter.ai/api', 'openai')).toBeNull();
  });

  it('still strips a trailing /v1 on OpenRouter (`/api/v1`)', () => {
    // The longer form should still normalize so the runtime can
    // append `/v1/...` cleanly.
    const r = describeBaseUrl('https://openrouter.ai/api/v1', 'openai');
    expect(r?.severity).toBe('info');
    expect(r?.normalized).toBe('https://openrouter.ai/api');
    expect(r?.message).toMatch(/Stripped trailing \/v1/);
  });

  it('does not strip a trailing /api on openai for non-OpenRouter hosts either', () => {
    // Same dialect rule everywhere: under OpenAI, `/api` is part of
    // the path the runtime is going to keep. Pasting it is unusual
    // outside OpenRouter, but the validator must not silently
    // mutate it.
    expect(describeBaseUrl('https://example.com/api', 'openai')).toBeNull();
  });

  it('does not warn for ollama-native pointed at 127.0.0.1', () => {
    expect(describeBaseUrl('http://127.0.0.1:11434', 'ollama-native')).toBeNull();
  });
});
