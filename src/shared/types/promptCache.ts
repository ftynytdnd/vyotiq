/** Runtime prompt-cache diagnostics surfaced to the renderer. */

export type GeminiExplicitCacheState =
  | 'disabled'
  | 'below_threshold'
  | 'active'
  | 'error';

export interface GeminiExplicitCacheStatus {
  state: GeminiExplicitCacheState;
  detail?: string;
}

export interface PromptCacheRuntimeStatus {
  geminiExplicitCache: GeminiExplicitCacheStatus;
}
