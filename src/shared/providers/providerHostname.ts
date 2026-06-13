/**
 * Single source of truth for parsing provider base URLs into host flags.
 * Pure — no I/O. Other modules derive host kind, attribution, and dialect
 * hints from this map instead of re-parsing URLs independently.
 */

import type { ProviderDialect } from '../types/provider.js';

export interface ProviderHostnameFlags {
  host: string | null;
  openrouter: boolean;
  openai: boolean;
  anthropic: boolean;
  deepseek: boolean;
  gemini: boolean;
  groq: boolean;
  together: boolean;
  mistral: boolean;
  xai: boolean;
  nvidia: boolean;
  ollamaCloud: boolean;
}

/** Parse hostname from a provider base URL; null when unparseable. */
export function providerHostname(baseUrl: string): string | null {
  try {
    return new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Hostname-derived flags used across discovery, billing, and attribution. */
export function parseProviderHostname(baseUrl: string): ProviderHostnameFlags {
  const host = providerHostname(baseUrl);
  if (!host) {
    return {
      host: null,
      openrouter: false,
      openai: false,
      anthropic: false,
      deepseek: false,
      gemini: false,
      groq: false,
      together: false,
      mistral: false,
      xai: false,
      nvidia: false,
      ollamaCloud: false
    };
  }

  return {
    host,
    openrouter: host === 'openrouter.ai' || host === 'www.openrouter.ai',
    openai: host === 'api.openai.com',
    anthropic: host === 'api.anthropic.com',
    deepseek: host === 'api.deepseek.com' || host.endsWith('.deepseek.com'),
    gemini: host === 'generativelanguage.googleapis.com',
    groq: host === 'api.groq.com',
    together: host === 'api.together.xyz' || host === 'api.together.ai',
    mistral: host === 'api.mistral.ai',
    xai: host === 'api.x.ai' || host === 'x.ai',
    nvidia: host === 'integrate.api.nvidia.com',
    ollamaCloud: host === 'ollama.com' || host === 'www.ollama.com'
  };
}

/** Well-known hosts map to a canonical dialect without network probes. */
export function dialectHintFromHostname(baseUrl: string): ProviderDialect | null {
  const flags = parseProviderHostname(baseUrl);
  if (flags.anthropic) return 'anthropic-native';
  if (flags.gemini) return 'gemini-native';
  if (flags.ollamaCloud) return 'ollama-native';
  return null;
}

/** models.dev provider bucket id for a known direct host (when applicable). */
export function modelsDevProviderId(baseUrl: string): string | undefined {
  const flags = parseProviderHostname(baseUrl);
  if (flags.openai) return 'openai';
  if (flags.anthropic) return 'anthropic';
  if (flags.deepseek) return 'deepseek';
  if (flags.gemini) return 'google';
  if (flags.groq) return 'groq';
  if (flags.together) return 'together';
  if (flags.mistral) return 'mistral';
  if (flags.xai) return 'xai';
  if (flags.nvidia) return 'nvidia';
  if (flags.openrouter) return 'openrouter';
  if (flags.ollamaCloud) return 'ollama-cloud';
  return undefined;
}
