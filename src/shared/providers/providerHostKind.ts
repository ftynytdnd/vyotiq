/**
 * Host classification for provider-specific account/billing fetchers.
 * Pure — no I/O.
 */

import type { ProviderConfig } from '../types/provider.js';
import { isClaudeCodeProxyBaseUrl } from './claudeCodeProxy.js';
import { isLocalProvider } from './isLocalProvider.js';
import { parseProviderHostname } from './providerHostname.js';

export type ProviderHostKind =
  | 'local'
  | 'claude-code-proxy'
  | 'openrouter'
  | 'openai'
  | 'anthropic'
  | 'deepseek'
  | 'gemini'
  | 'groq'
  | 'together'
  | 'mistral'
  | 'xai'
  | 'nvidia'
  | 'ollama-cloud'
  | 'generic';

/** Classify a provider's upstream host for account fetch routing. */
export function classifyProviderHost(
  provider: Pick<ProviderConfig, 'baseUrl' | 'dialect' | 'notes'>
): ProviderHostKind {
  if (isClaudeCodeProxyBaseUrl(provider.baseUrl, provider.notes)) return 'claude-code-proxy';
  if (isLocalProvider(provider)) return 'local';

  const flags = parseProviderHostname(provider.baseUrl);
  if (!flags.host) return 'generic';

  if (flags.openrouter) return 'openrouter';
  if (flags.openai) return 'openai';
  if (flags.anthropic) return 'anthropic';
  if (flags.deepseek) return 'deepseek';
  if (flags.gemini) return 'gemini';
  if (flags.groq) return 'groq';
  if (flags.together) return 'together';
  if (flags.mistral) return 'mistral';
  if (flags.xai) return 'xai';
  if (flags.nvidia) return 'nvidia';
  if (flags.ollamaCloud) return 'ollama-cloud';

  if (provider.dialect === 'anthropic-native') return 'anthropic';
  if (provider.dialect === 'gemini-native') return 'gemini';
  if (provider.dialect === 'ollama-native') return 'ollama-cloud';

  return 'generic';
}

/** Default dashboard URL for a host kind. */
export function defaultDashboardUrl(kind: ProviderHostKind): string | undefined {
  switch (kind) {
    case 'openrouter':
      return 'https://openrouter.ai/settings/credits';
    case 'openai':
      return 'https://platform.openai.com/settings/organization/billing';
    case 'anthropic':
      return 'https://console.anthropic.com/settings/billing';
    case 'deepseek':
      return 'https://platform.deepseek.com/top_up';
    case 'gemini':
      return 'https://aistudio.google.com/';
    case 'groq':
      return 'https://console.groq.com/settings/billing';
    case 'together':
      return 'https://api.together.ai/settings/billing';
    case 'mistral':
      return 'https://console.mistral.ai/billing/';
    case 'xai':
      return 'https://console.x.ai/';
    case 'nvidia':
      return 'https://build.nvidia.com/';
    case 'ollama-cloud':
      return 'https://ollama.com/settings';
    case 'claude-code-proxy':
      return undefined;
    case 'local':
    case 'generic':
      return undefined;
  }
}
