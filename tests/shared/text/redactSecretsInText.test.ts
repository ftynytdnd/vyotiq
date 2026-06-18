import { describe, expect, it } from 'vitest';
import { redactSecretsInText, redactSensitiveText } from '@shared/text/redactSecretsInText';

describe('redactSecretsInText', () => {
  it('redacts sk- keys and bearer tokens', () => {
    const input =
      'key=sk-proj-abcdefghijklmnopqrstuvwxyz\nAuthorization: Bearer eyJhbGciOiJIUzI1NiJ9';
    const out = redactSecretsInText(input);
    expect(out).toContain('sk-[REDACTED]');
    expect(out).toContain('Bearer [REDACTED]');
    expect(out).not.toContain('sk-proj-');
    expect(out).not.toContain('eyJhbGci');
  });

  it('redacts assignment-style secrets in .env reads', () => {
    const input = 'api_key="super-secret-value"\nSECRET_TOKEN: abc123xyz';
    const out = redactSecretsInText(input);
    expect(out).toContain('api_key=[REDACTED]');
    expect(out).toContain('SECRET_TOKEN:[REDACTED]');
    expect(out).not.toContain('super-secret-value');
    expect(out).not.toContain('abc123xyz');
  });
});

describe('redactSensitiveText', () => {
  it('chains home and secret redaction', () => {
    const out = redactSensitiveText('key=sk-abcdefghijklmnopqrst at C:\\Users\\admin\\.env');
    expect(out).toContain('sk-[REDACTED]');
    expect(out).not.toContain('sk-abcdefghijklmnopqrst');
  });
});
