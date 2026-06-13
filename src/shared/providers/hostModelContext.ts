/**
 * Model context windows for direct provider hosts when /v1/models does not
 * expose context metadata. Sourced from official provider model pages (2026).
 * OpenRouter and similar gateways still parse context from model-list rows.
 */

import type { ProviderHostKind } from './providerHostKind.js';

type ContextRow = { match: RegExp; contextWindow: number };

function row(contextWindow: number, match: RegExp): ContextRow {
  return { contextWindow, match };
}

/** Ordered — first match wins. */
const HOST_CONTEXT: Partial<Record<ProviderHostKind, ContextRow[]>> = {
  openai: [
    row(1_050_000, /^gpt-5\.5-pro$/i),
    row(1_050_000, /^gpt-5\.5$/i),
    row(1_050_000, /^gpt-5\.4-pro$/i),
    row(1_050_000, /^gpt-5\.4$/i),
    row(1_050_000, /^gpt-5\.4-mini$/i),
    row(1_050_000, /^gpt-5\.4-nano$/i),
    row(1_050_000, /^gpt-5\.3-codex$/i),
    row(1_047_576, /^gpt-4\.1$/i),
    row(1_047_576, /^gpt-4\.1-mini$/i),
    row(1_047_576, /^gpt-4\.1-nano$/i),
    row(128_000, /^gpt-4o$/i),
    row(128_000, /^gpt-4o-mini$/i),
    row(200_000, /^o1-pro$/i),
    row(200_000, /^o1$/i),
    row(200_000, /^o3-mini$/i),
    row(128_000, /^o4-mini$/i)
  ],
  anthropic: [
    row(1_000_000, /^claude-opus-4/i),
    row(200_000, /^claude-sonnet-4/i),
    row(200_000, /^claude-haiku-4/i),
    row(200_000, /^claude-3-opus/i),
    row(200_000, /^claude-3-5-sonnet/i),
    row(200_000, /^claude-3-5-haiku/i),
    row(200_000, /^claude-3-haiku/i)
  ],
  deepseek: [
    row(1_000_000, /^deepseek-/i)
  ],
  gemini: [
    row(1_048_576, /^gemini-3\.1-pro/i),
    row(1_048_576, /^gemini-3-pro/i),
    row(1_048_576, /^gemini-3-flash/i),
    row(1_048_576, /^gemini-3\.1-flash-lite/i),
    row(1_048_576, /^gemini-2\.5-pro$/i),
    row(1_048_576, /^gemini-2\.5-flash$/i),
    row(1_048_576, /^gemini-2\.0-flash$/i),
    row(1_048_576, /^gemini-2\.0-flash-lite$/i)
  ],
  groq: [
    row(131_072, /^llama-3\.1-8b-instant$/i),
    row(131_072, /^llama-3\.3-70b-versatile$/i),
    row(131_072, /^meta-llama\/llama-4-scout/i),
    row(131_072, /^openai\/gpt-oss-20b$/i),
    row(131_072, /^openai\/gpt-oss-120b$/i)
  ],
  together: [
    row(131_072, /^meta-llama\/Llama-3\.3-70B-Instruct/i),
    row(131_072, /^meta-llama\/Llama-3\.1-8B-Instruct/i),
    row(131_072, /^meta-llama\/Llama-4/i)
  ],
  mistral: [
    row(128_000, /^mistral-large/i),
    row(128_000, /^mistral-small/i),
    row(128_000, /^ministral/i)
  ],
  xai: [
    row(131_072, /^grok-4$/i),
    row(131_072, /^grok-3$/i),
    row(131_072, /^grok-3-mini$/i),
    row(131_072, /^grok-2-mini$/i)
  ]
};

function normalizeModelId(modelId: string): string {
  const trimmed = modelId.trim();
  const slash = trimmed.indexOf('/');
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}

/** Lookup curated context window for a direct provider host + model id. */
export function lookupHostModelContext(
  hostKind: ProviderHostKind,
  modelId: string
): number | undefined {
  const rows = HOST_CONTEXT[hostKind];
  if (!rows?.length) return undefined;
  const id = normalizeModelId(modelId);
  for (const r of rows) {
    if (r.match.test(id) || r.match.test(modelId)) {
      return r.contextWindow;
    }
  }
  return undefined;
}

/** Attach host context when discovery did not populate `contextWindow`. */
export function enrichModelContext(
  hostKind: ProviderHostKind,
  modelId: string,
  existing?: number
): number | undefined {
  if (typeof existing === 'number' && existing > 0) return existing;
  return lookupHostModelContext(hostKind, modelId);
}
