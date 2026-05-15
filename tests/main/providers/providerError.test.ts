/**
 * Locks the HTTP-status → `ProviderErrorKind` mapping and the
 * `friendlyMessage` shape. Both stream transports
 * (`openaiChatStream`, `ollamaChatStream`) and `ProviderRow`'s
 * "Test connection" path rely on this mapping; if it drifts, the
 * timeline goes back to dumping raw 402 stack traces at the user.
 */

import { describe, expect, it } from 'vitest';
import {
  classifyProviderError,
  isProviderError,
  ProviderError
} from '@main/providers/providerError';

const baseInput = {
  url: 'https://api.example.com/v1/chat/completions',
  body: '{"error":{"message":"…"}}',
  surface: 'chat' as const,
  providerId: 'p1',
  providerName: 'Example'
};

function make(status: number, statusText = '') {
  return classifyProviderError({ ...baseInput, status, statusText });
}

describe('classifyProviderError — kind mapping', () => {
  it('402 → billing', () => {
    expect(make(402).kind).toBe('billing');
  });

  it('401 → auth', () => {
    expect(make(401).kind).toBe('auth');
  });

  it('403 with generic auth body → auth', () => {
    expect(make(403).kind).toBe('auth');
  });

  it('403 with subscription-shaped body → billing (Ollama Cloud entitlement error)', () => {
    // Ollama Cloud surfaces 403 for subscription / entitlement
    // failures with a body that explicitly mentions upgrading. The
    // pre-fix mapping classified this as `auth` and pointed the user
    // at the API-key field — wrong remediation. The new behavior
    // classifies these specific bodies as `billing` and keeps the
    // generic 403s on the `auth` path.
    const err = classifyProviderError({
      ...baseInput,
      status: 403,
      statusText: 'Forbidden',
      body: '{"error":"this model requires a subscription, upgrade for access: https://ollama.com/upgrade"}'
    });
    expect(err.kind).toBe('billing');
    expect(err.friendlyMessage).toMatch(/subscription|upgrade/i);
    // Critically — does NOT mislead the user toward the API-key fix.
    expect(err.friendlyMessage).not.toMatch(/Authentication failed/i);
  });

  it('429 → rate-limit', () => {
    expect(make(429).kind).toBe('rate-limit');
  });

  it('chat 404 → model-not-found', () => {
    expect(make(404).kind).toBe('model-not-found');
  });

  it('discovery 404 → endpoint-missing', () => {
    const err = classifyProviderError({ ...baseInput, status: 404, statusText: '', surface: 'discovery' });
    expect(err.kind).toBe('endpoint-missing');
  });

  it('500 → server', () => {
    expect(make(500).kind).toBe('server');
  });

  it('503 → server', () => {
    expect(make(503).kind).toBe('server');
  });

  it('418 (teapot) → unknown', () => {
    expect(make(418).kind).toBe('unknown');
  });
});

describe('classifyProviderError — friendlyMessage', () => {
  it('billing message names the provider and mentions topping up', () => {
    const err = make(402);
    expect(err.friendlyMessage).toMatch(/Example/);
    expect(err.friendlyMessage).toMatch(/balance|top up/i);
  });

  it('auth message points to settings', () => {
    expect(make(401).friendlyMessage).toMatch(/Settings/);
  });

  it('rate-limit message describes the condition WITHOUT promising retry', () => {
    // The runtime's per-worker self-correction loop owns the
    // "we will retry" semantics — the worker's `liveStatus` row
    // shimmers `Retrying provider call (n/3)…` while a backoff
    // window is active and flips to `Failed` after the third
    // strike. Hard-coding "Retrying with backoff." inside the
    // friendly message lied on the latter case (the message stuck
    // around on the failed row even though no retry was queued).
    // Lock the cleaner contract: describe the condition, no
    // future-tense retry promise.
    const msg = make(429).friendlyMessage;
    expect(msg).toMatch(/rate limit/i);
    expect(msg).not.toMatch(/retry|backoff/i);
  });

  it('model-not-found message mentions Refresh', () => {
    expect(make(404).friendlyMessage).toMatch(/Refresh/);
  });

  it('unknown (400) appends the body JSON error string for triage', () => {
    // Ollama Cloud shape: `{"error":"model x not found"}`.
    const err = classifyProviderError({
      ...baseInput,
      status: 400,
      statusText: 'Bad Request',
      body: '{"error":"model \\"nope\\" not found, try pulling it first"}'
    });
    expect(err.kind).toBe('unknown');
    expect(err.friendlyMessage).toContain('HTTP 400');
    expect(err.friendlyMessage).toContain('model "nope" not found');
  });

  it('unknown (400) extracts nested {error:{message}} shape (OpenAI-compat)', () => {
    // OpenAI's own error envelope uses `{error:{message:"…"}}`.
    const err = classifyProviderError({
      ...baseInput,
      status: 400,
      statusText: 'Bad Request',
      body: '{"error":{"message":"Invalid value for parameter tools.0.function.name"}}'
    });
    expect(err.friendlyMessage).toContain('Invalid value for parameter');
  });

  it('unknown (400) falls back to first line for plaintext bodies', () => {
    const err = classifyProviderError({
      ...baseInput,
      status: 400,
      statusText: 'Bad Request',
      body: 'something broke\nsecond line is discarded'
    });
    expect(err.friendlyMessage).toContain('something broke');
    expect(err.friendlyMessage).not.toContain('second line');
  });

  it('unknown (400) is a no-op when the body is empty', () => {
    const err = classifyProviderError({
      ...baseInput,
      status: 400,
      statusText: 'Bad Request',
      body: ''
    });
    // Should be the bare form, no trailing text after the period.
    expect(err.friendlyMessage).toMatch(/Request failed \(HTTP 400 Bad Request\)\.$/);
  });

  it('Error.message is the clean friendlyMessage (survives IPC structured-clone)', () => {
    const err = make(402);
    // `Error.message` is the only field that survives the Electron
    // IPC boundary on its way to the renderer. We put the friendly
    // single-line copy there so `e.message` in the renderer is
    // already user-presentable. Structured fields (`kind`, `status`,
    // `rawBody`) stay reachable on the instance for tests + main-
    // process triage.
    expect(err.message).toBe(err.friendlyMessage);
    expect(err.message).not.toContain(baseInput.body);
    // The raw body is still preserved for triage:
    expect(err.rawBody).toBe(baseInput.body);
  });
});

describe('isProviderError', () => {
  it('narrows ProviderError instances', () => {
    expect(isProviderError(make(402))).toBe(true);
  });

  it('rejects plain Errors', () => {
    expect(isProviderError(new Error('boom'))).toBe(false);
  });

  it('rejects non-error values', () => {
    expect(isProviderError(null)).toBe(false);
    expect(isProviderError('boom')).toBe(false);
    expect(isProviderError(undefined)).toBe(false);
  });

  it('survives the prototype chain', () => {
    const err = new ProviderError({
      kind: 'billing',
      status: 402,
      providerId: 'p',
      providerName: 'X',
      friendlyMessage: 'm',
      surface: 'chat',
      rawBody: ''
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ProviderError');
  });
});
