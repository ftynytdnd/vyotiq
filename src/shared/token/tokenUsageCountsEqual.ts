import type { TokenUsage } from '../types/chat.js';

/** True when two usage snapshots bill the same token counts. */
export function tokenUsageCountsEqual(a: TokenUsage, b: TokenUsage): boolean {
  return (
    a.promptTokens === b.promptTokens &&
    a.completionTokens === b.completionTokens &&
    a.totalTokens === b.totalTokens &&
    a.reasoningTokens === b.reasoningTokens &&
    a.cachedPromptTokens === b.cachedPromptTokens &&
    a.cacheCreationTokens === b.cacheCreationTokens &&
    a.uncachedPromptTokens === b.uncachedPromptTokens
  );
}
