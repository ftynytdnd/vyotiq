/**
 * Provider capability helpers.
 *
 * The forced-action orchestrator loop always sends `tool_choice:'required'`
 * so the model is structurally obliged to act via a tool call. Not every
 * wire dialect honours that field, though, so this helper records which
 * dialects can be trusted to enforce it server-side versus which need the
 * graceful prompt-force degradation path instead.
 */

import type { ProviderDialect } from '@shared/types/provider.js';

/**
 * Whether a dialect reliably enforces `tool_choice` server-side.
 *
 *   - `openai`, `anthropic-native`, `gemini-native` → `true`. All three
 *     honour a forced/required tool choice on the wire.
 *   - `undefined` → `false`. Unknown or legacy providers without an
 *     explicit dialect must use the prompt-force degradation path
 *     rather than assuming OpenAI-compat forced tool choice works.
 *   - `ollama-native` → `false`. Ollama's OpenAI-compatibility surface
 *     lists `tool_choice` as unsupported (docs.ollama.com OpenAI
 *     compatibility), and its native `/api/chat` has no equivalent, so a
 *     `required` choice is silently ignored. Callers must fall back to
 *     prompt-force (system instruction + temperature 0) for these.
 */
export function supportsForcedToolChoice(dialect: ProviderDialect | undefined): boolean {
  switch (dialect) {
    case 'openai':
    case 'anthropic-native':
    case 'gemini-native':
      return true;
    case undefined:
      return false;
    case 'ollama-native':
      return false;
  }
}

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
