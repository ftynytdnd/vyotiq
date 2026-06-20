/**
 * OpenAI automatic prompt caching stickiness.
 * @see https://developers.openai.com/api/docs/guides/prompt-caching
 */

import type { ProviderWithKey } from '@shared/types/provider.js';
import { classifyProviderHost } from '@shared/providers/providerHostKind.js';
import { getPromptCachingSettings } from '../../settings/promptCachingRuntime.js';

export interface OpenAiCacheHintOpts {
  workspaceId?: string;
  conversationId?: string;
  modelId: string;
}

/** GPT-5-series models default to 24h extended retention (2026). */
function supportsExtendedPromptCacheRetention(modelId: string, hostKind: string): boolean {
  if (hostKind !== 'openai') return false;
  const id = modelId.toLowerCase();
  return (
    id.startsWith('gpt-5') ||
    id.startsWith('o3') ||
    id.startsWith('o4')
  );
}

/**
 * Mutates the OpenAI-compat request body with cache routing hints.
 * Harmless on providers that ignore unknown fields.
 */
export function applyOpenAiCacheHints(
  body: Record<string, unknown>,
  provider: ProviderWithKey,
  opts: OpenAiCacheHintOpts
): void {
  const ws = opts.workspaceId?.trim();
  const conv = opts.conversationId?.trim();
  if (ws && conv) {
    body['prompt_cache_key'] = `${ws}:${conv}`;
  } else if (conv) {
    body['prompt_cache_key'] = conv;
  }

  const hostKind = classifyProviderHost(provider);
  if (
    getPromptCachingSettings().openaiExtendedCacheRetention &&
    supportsExtendedPromptCacheRetention(opts.modelId, hostKind)
  ) {
    body['prompt_cache_retention'] = '24h';
  }
}
