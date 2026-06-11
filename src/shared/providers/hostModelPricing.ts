/**
 * Model pricing for direct provider hosts when /v1/models does not
 * expose pricing. Sourced from official provider pricing pages (2026).
 * OpenRouter and similar gateways still parse pricing from model-list rows.
 */

import type { ModelPricing } from './modelPricing.js';
import type { ProviderHostKind } from './providerHostKind.js';

type PricingRow = ModelPricing & { match: RegExp };

function row(input: number, output: number, match: RegExp): PricingRow {
  return { inputPerMillion: input, outputPerMillion: output, match };
}

/** Ordered — first match wins. */
const HOST_PRICING: Partial<Record<ProviderHostKind, PricingRow[]>> = {
  openai: [
    row(5, 30, /^gpt-5\.5-pro$/i),
    row(5, 30, /^gpt-5\.5$/i),
    row(30, 180, /^gpt-5\.4-pro$/i),
    row(2.5, 15, /^gpt-5\.4$/i),
    row(0.75, 4.5, /^gpt-5\.4-mini$/i),
    row(0.2, 1.25, /^gpt-5\.4-nano$/i),
    row(1.75, 14, /^gpt-5\.3-codex$/i),
    row(3, 12, /^gpt-4\.1$/i),
    row(0.8, 3.2, /^gpt-4\.1-mini$/i),
    row(0.2, 0.8, /^gpt-4\.1-nano$/i),
    row(3.75, 15, /^gpt-4o$/i),
    row(0.3, 1.2, /^gpt-4o-mini$/i),
    row(15, 60, /^o1-pro$/i),
    row(15, 60, /^o1$/i),
    row(3, 12, /^o3-mini$/i),
    row(2, 8, /^o4-mini$/i)
  ],
  anthropic: [
    row(15, 75, /^claude-opus-4/i),
    row(3, 15, /^claude-sonnet-4/i),
    row(0.8, 4, /^claude-haiku-4/i),
    row(15, 75, /^claude-3-opus/i),
    row(3, 15, /^claude-3-5-sonnet/i),
    row(0.25, 1.25, /^claude-3-5-haiku/i),
    row(0.25, 1.25, /^claude-3-haiku/i)
  ],
  deepseek: [
    row(0.27, 1.1, /^deepseek-chat$/i),
    row(0.55, 2.19, /^deepseek-reasoner$/i)
  ],
  gemini: [
    row(2, 12, /^gemini-3\.1-pro/i),
    row(2, 12, /^gemini-3-pro/i),
    row(0.5, 3, /^gemini-3-flash/i),
    row(0.25, 1.5, /^gemini-3\.1-flash-lite/i),
    row(1.25, 10, /^gemini-2\.5-pro$/i),
    row(0.15, 0.6, /^gemini-2\.5-flash$/i),
    row(0.1, 0.4, /^gemini-2\.0-flash$/i),
    row(0.075, 0.3, /^gemini-2\.0-flash-lite$/i)
  ],
  groq: [
    row(0.05, 0.08, /^llama-3\.1-8b-instant$/i),
    row(0.59, 0.79, /^llama-3\.3-70b-versatile$/i),
    row(0.11, 0.34, /^meta-llama\/llama-4-scout/i),
    row(0.2, 0.6, /^openai\/gpt-oss-20b$/i),
    row(0.15, 0.75, /^openai\/gpt-oss-120b$/i)
  ],
  together: [
    row(0.18, 0.18, /^meta-llama\/Llama-3\.3-70B-Instruct/i),
    row(0.1, 0.1, /^meta-llama\/Llama-3\.1-8B-Instruct/i),
    row(0.18, 0.18, /^meta-llama\/Llama-4/i)
  ],
  mistral: [
    row(2, 6, /^mistral-large/i),
    row(0.2, 0.6, /^mistral-small/i),
    row(0.1, 0.3, /^ministral/i)
  ],
  xai: [
    row(3, 15, /^grok-4$/i),
    row(2, 10, /^grok-3$/i),
    row(0.2, 0.5, /^grok-3-mini$/i),
    row(0.2, 0.5, /^grok-2-mini$/i)
  ]
};

function normalizeModelId(modelId: string): string {
  const trimmed = modelId.trim();
  const slash = trimmed.indexOf('/');
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}

/** Lookup curated pricing for a direct provider host + model id. */
export function lookupHostModelPricing(
  hostKind: ProviderHostKind,
  modelId: string
): ModelPricing | undefined {
  const rows = HOST_PRICING[hostKind];
  if (!rows?.length) return undefined;
  const id = normalizeModelId(modelId);
  for (const r of rows) {
    if (r.match.test(id) || r.match.test(modelId)) {
      const { match: _m, ...pricing } = r;
      return pricing;
    }
  }
  return undefined;
}

/** Attach host pricing when discovery did not populate `pricing`. */
export function enrichModelPricing(
  hostKind: ProviderHostKind,
  modelId: string,
  existing?: ModelPricing
): ModelPricing | undefined {
  if (existing) return existing;
  return lookupHostModelPricing(hostKind, modelId);
}
