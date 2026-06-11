/**
 * Whether a provider dialect surfaces prompt-cache fields on the wire.
 * @see TokenUsage in `@shared/types/chat.js` — Ollama documents no cache breakdown.
 */

import type { ProviderDialect } from '../types/provider.js';

/** True when upstream usage may include `cachedPromptTokens` / related fields. */
export function providerDialectReportsPromptCache(dialect: ProviderDialect): boolean {
  switch (dialect) {
    case 'openai':
    case 'anthropic-native':
    case 'gemini-native':
      return true;
    case 'ollama-native':
      return false;
    default: {
      const _exhaustive: never = dialect;
      return _exhaustive;
    }
  }
}
