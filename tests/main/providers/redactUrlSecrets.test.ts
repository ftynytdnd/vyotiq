import { describe, expect, it } from 'vitest';
import { redactUrlSecrets } from '@main/providers/redactUrlSecrets.js';

describe('redactUrlSecrets', () => {
  it('redacts key query parameters', () => {
    const url =
      'https://generativelanguage.googleapis.com/v1beta/models/gemini:stream?key=SECRET123&alt=sse';
    const out = redactUrlSecrets(url);
    expect(out).not.toContain('SECRET123');
    expect(decodeURIComponent(out)).toContain('[REDACTED]');
  });
});
