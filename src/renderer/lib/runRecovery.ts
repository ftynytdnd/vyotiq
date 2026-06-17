const PROVIDER_HINT =
  /rate\s*limit|provider failed|ollama|openai|anthropic|openrouter|deepseek|groq|together|api key|unauthorized|forbidden|model|api settings|insufficient balance|top up|billing|switch providers/i;

export function suggestProvidersForError(message: string): boolean {
  return PROVIDER_HINT.test(message);
}
