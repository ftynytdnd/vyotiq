import type { TimelineEvent } from '@shared/types/chat.js';

export interface RunRecoveryState {
  errorMessage: string;
  /** Surface a providers shortcut when the failure looks provider-related. */
  suggestProviders: boolean;
}

const PROVIDER_HINT =
  /rate\s*limit|provider failed|ollama|openai|anthropic|openrouter|deepseek|groq|together|api key|unauthorized|forbidden|model|api settings|insufficient balance|top up|billing|switch providers/i;

export function suggestProvidersForError(message: string): boolean {
  return PROVIDER_HINT.test(message);
}

export function selectRunRecoveryState(
  events: readonly TimelineEvent[],
  isProcessing: boolean,
  lastUserPromptContent: string | undefined
): RunRecoveryState | null {
  if (isProcessing) return null;
  const prompt = lastUserPromptContent?.trim();
  if (!prompt || events.length === 0) return null;

  const last = events[events.length - 1];
  if (!last || last.kind !== 'error') return null;

  return {
    errorMessage: last.message,
    suggestProviders: suggestProvidersForError(last.message)
  };
}
