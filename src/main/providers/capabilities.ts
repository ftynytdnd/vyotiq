/**
 * Provider capability helpers for wire-dialect feature flags.
 */

import type { ModelThinkingCapabilities, ProviderDialect, ThinkingEffort } from '@shared/types/provider.js';
import { modelRejectsToolChoice } from '@shared/providers/thinkingEffort.js';

/** Whether the wire dialect accepts `parallel_tool_calls: true`. */
export function supportsParallelToolCalls(dialect: ProviderDialect | undefined): boolean {
  switch (dialect) {
    case 'openai':
    case 'anthropic-native':
      return true;
    case 'gemini-native':
    case 'ollama-native':
    case undefined:
      return false;
  }
}

/**
 * Whether it is safe to send a `tool_choice` field on the wire for this
 * model + thinking state. Returns `false` for always-thinking models
 * that reject forced/required choice (DeepSeek V4): the caller must
 * OMIT the field entirely (the server defaults to `auto`) rather than
 * sending an explicit value, which 400s the request. See
 * `@shared/providers/thinkingEffort.ts :: modelRejectsToolChoice`.
 */
export function supportsToolChoice(
  dialect: ProviderDialect | undefined,
  modelId: string,
  effort: ThinkingEffort | undefined,
  caps?: ModelThinkingCapabilities
): boolean {
  return !modelRejectsToolChoice(dialect, modelId, effort, caps);
}
