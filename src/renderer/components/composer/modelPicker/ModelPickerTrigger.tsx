/**
 * ModelPickerTrigger — the pill button that opens the picker. Shows
 * the model id as the primary label. Falls back to a placeholder when
 * nothing is selected.
 */

import { forwardRef } from 'react';
import { ChevronDown } from 'lucide-react';
import type { ModelSelection } from '@shared/types/provider.js';
import { useProviderStore } from '../../../store/useProviderStore.js';
import { cn } from '../../../lib/cn.js';
import { chromeToolbarButtonClassName } from '../../ui/SurfaceShell.js';
import { SHELL_COMPACT_ICON_CLASS, SHELL_COMPACT_ICON_STROKE } from '../../../lib/shellIcons.js';

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
    const tooltip = provider
      ? `${provider.name} \u00b7 ${modelId || placeholder}`
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
        className={cn(
          chromeToolbarButtonClassName(open),
          'vx-composer-model-trigger h-6 shrink-0 max-w-[12rem] items-center gap-1 px-1.5 text-chat-meta text-text-secondary'
        )}
      >
        <span className="min-w-0 truncate font-mono" title={modelId || undefined}>
          {modelId || placeholder}
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
