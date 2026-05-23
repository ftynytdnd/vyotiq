/**
 * Redact sensitive query parameters (API keys) from URLs before logging.
 */

const SECRET_QUERY_KEYS = new Set(['key', 'api_key', 'apikey', 'access_token', 'token']);

export function redactUrlSecrets(url: string): string {
  try {
    const parsed = new URL(url);
    for (const key of [...parsed.searchParams.keys()]) {
      if (SECRET_QUERY_KEYS.has(key.toLowerCase())) {
        parsed.searchParams.set(key, '[REDACTED]');
      }
    }
    return parsed.toString();
  } catch {
    return url.replace(/([?&](?:key|api_key|apikey|access_token|token)=)[^&]+/gi, '$1[REDACTED]');
  }
}
