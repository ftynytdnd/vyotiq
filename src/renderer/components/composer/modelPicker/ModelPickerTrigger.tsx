/**
 * ModelPickerTrigger — composer-styled button that opens the picker.
 * Shows shortened tail model id; full id + provider in tooltip.
 */

import { forwardRef } from 'react';
import { ChevronDown } from 'lucide-react';
import type { ModelSelection, ThinkingEffort } from '@shared/types/provider.js';
import {
  isThinkingCapableModel,
  THINKING_EFFORT_LABELS
} from '@shared/providers/thinkingEffort.js';
import { useProviderStore } from '../../../store/useProviderStore.js';
import { cn } from '../../../lib/cn.js';
import { SHELL_COMPACT_ICON_CLASS, SHELL_COMPACT_ICON_STROKE } from '../../../lib/shellIcons.js';
import { rowDisplayModelId } from './modelPickerDisplay.js';

interface ModelPickerTriggerProps {
  value: ModelSelection | null;
  open: boolean;
  onClick: () => void;
}

export const ModelPickerTrigger = forwardRef<HTMLButtonElement, ModelPickerTriggerProps>(
  function ModelPickerTrigger({ value, open, onClick }, ref) {
    const providers = useProviderStore((s) => s.providers);
    const provider = value ? providers.find((p) => p.id === value.providerId) : null;
    const hasEnabledProvider = providers.some((p) => p.enabled);

    const placeholder = hasEnabledProvider ? 'Select model…' : 'Add provider';
    const modelId = value?.modelId ?? '';
    const displayId = modelId ? rowDisplayModelId(modelId) : '';
    const effortLabel = ((): string | null => {
      if (!value || !provider) return null;
      const effort: ThinkingEffort | undefined =
        value.thinkingEffort ?? provider.modelThinking?.[value.modelId];
      const modelInfo = provider.models?.find((m) => m.id === value.modelId);
      if (
        effort === undefined ||
        effort === 'off' ||
        !isThinkingCapableModel(provider.dialect, value.modelId, {
          supportedParameters: modelInfo?.supportedParameters,
          thinking: modelInfo?.thinking
        })
      ) {
        return null;
      }
      return THINKING_EFFORT_LABELS[effort];
    })();
    const tooltip = provider
      ? `${provider.name} \u00b7 ${modelId || placeholder}${effortLabel ? ` \u00b7 ${effortLabel}` : ''}`
      : placeholder;

    return (
      <button
        ref={ref}
        type="button"
        onClick={onClick}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Model: ${tooltip}`}
        title={tooltip}
        className="vx-composer-model-trigger vx-btn vx-btn-quiet app-no-drag"
      >
        <span className="flex min-w-0 items-baseline gap-0.5">
          <span className="min-w-0 truncate font-mono text-chat-meta" title={modelId || undefined}>
            {displayId || placeholder}
          </span>
          {effortLabel ? (
            <span className="shrink-0 text-text-faint">· {effortLabel}</span>
          ) : null}
        </span>
        <ChevronDown
          className={cn(
            SHELL_COMPACT_ICON_CLASS,
            'shrink-0 transition-transform duration-150',
            open && 'rotate-180'
          )}
          strokeWidth={SHELL_COMPACT_ICON_STROKE}
          aria-hidden
        />
      </button>
    );
  }
);
