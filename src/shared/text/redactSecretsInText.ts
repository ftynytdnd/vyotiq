/**
 * Redact likely secrets from tool output and chat text before persist,
 * replay, or provider wire.
 */

import { redactUserHomeInText } from '../path/redactUserHomeInPath.js';

const OPENAI_STYLE_KEY_RE = /\bsk-[a-zA-Z0-9_-]{8,}\b/g;
const BEARER_TOKEN_RE = /Bearer\s+[a-zA-Z0-9._\-+/=]{8,}/gi;
const ASSIGNMENT_SECRET_RE =
  /[A-Za-z0-9_]+(?:key|token|secret|password)\s*[=:]\s*['"]?[^\s'"]{4,}/gi;

/** Replace common API-key and assignment patterns with stable placeholders. */
export function redactSecretsInText(text: string): string {
  if (!text) return text;
  return text
    .replace(OPENAI_STYLE_KEY_RE, 'sk-[REDACTED]')
    .replace(BEARER_TOKEN_RE, 'Bearer [REDACTED]')
    .replace(ASSIGNMENT_SECRET_RE, (match) => {
      const sep = match.includes('=') ? '=' : ':';
      const key = match.split(sep)[0] ?? 'secret';
      return `${key}${sep}[REDACTED]`;
    });
}

/** User-home redaction plus secret-pattern scrubbing. */
export function redactSensitiveText(text: string): string {
  return redactSecretsInText(redactUserHomeInText(text));
}
