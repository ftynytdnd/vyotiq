/**
 * Resolved defaults for `settings.ui.inlineCompletion`.
 */

import type { AppSettings } from '../types/ipc.js';
import type { ModelSelection } from '../types/provider.js';

export interface InlineCompletionSettings {
  enabled: boolean;
  editorEnabled: boolean;
  composerEnabled: boolean;
  /** When set, overrides the active chat model for completion requests. */
  model: ModelSelection | null;
  debounceMs: number;
}

export const DEFAULT_INLINE_COMPLETION_SETTINGS: InlineCompletionSettings = {
  enabled: true,
  editorEnabled: true,
  composerEnabled: true,
  model: null,
  debounceMs: 450
} as const;

export function resolveInlineCompletionSettings(
  ui?: AppSettings['ui']
): InlineCompletionSettings {
  const ic = ui?.inlineCompletion;
  const debounce = ic?.debounceMs;
  const model =
    ic?.providerId && ic?.modelId
      ? { providerId: ic.providerId, modelId: ic.modelId }
      : null;
  return {
    enabled: ic?.enabled !== false,
    editorEnabled: ic?.editorEnabled !== false,
    composerEnabled: ic?.composerEnabled !== false,
    model,
    debounceMs:
      typeof debounce === 'number' && Number.isFinite(debounce)
        ? Math.min(2000, Math.max(150, Math.round(debounce)))
        : DEFAULT_INLINE_COMPLETION_SETTINGS.debounceMs
  };
}

/** Completion model: dedicated setting, else active chat model. */
export function resolveCompletionModelSelection(
  settings: InlineCompletionSettings,
  chatModel: ModelSelection | null
): ModelSelection | null {
  if (!settings.enabled) return null;
  return settings.model ?? chatModel;
}
