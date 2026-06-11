/**
 * Host classification for provider-specific account/billing fetchers.
 * Pure — no I/O.
 */

import type { ProviderConfig } from '../types/provider.js';
import { isLocalProvider } from './isLocalProvider.js';

export type ProviderHostKind =
  | 'local'
  | 'openrouter'
  | 'openai'
  | 'anthropic'
  | 'deepseek'
  | 'gemini'
  | 'groq'
  | 'together'
  | 'mistral'
  | 'xai'
  | 'ollama-cloud'
  | 'generic';

function hostname(baseUrl: string): string | null {
  try {
    return new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Classify a provider's upstream host for account fetch routing. */
export function classifyProviderHost(provider: Pick<ProviderConfig, 'baseUrl' | 'dialect'>): ProviderHostKind {
  if (isLocalProvider(provider)) return 'local';

  const host = hostname(provider.baseUrl);
  if (!host) return 'generic';

  if (host === 'openrouter.ai' || host === 'www.openrouter.ai') return 'openrouter';
  if (host === 'api.openai.com') return 'openai';
  if (host === 'api.anthropic.com') return 'anthropic';
  if (host === 'api.deepseek.com') return 'deepseek';
  if (host === 'generativelanguage.googleapis.com') return 'gemini';
  if (host === 'api.groq.com') return 'groq';
  if (host === 'api.together.xyz' || host === 'api.together.ai') return 'together';
  if (host === 'api.mistral.ai') return 'mistral';
  if (host === 'api.x.ai' || host === 'x.ai') return 'xai';
  if (host === 'ollama.com' || host === 'www.ollama.com') return 'ollama-cloud';

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
    case 'ollama-cloud':
      return 'https://ollama.com/settings';
    case 'local':
    case 'generic':
      return undefined;
  }
}
