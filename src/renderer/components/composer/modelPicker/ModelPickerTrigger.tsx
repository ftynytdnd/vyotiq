/**
 * ModelPickerTrigger — the pill button that opens the picker. Shows
 * the active provider name as a badge and the model id as the primary
 * label. Falls back to a placeholder when nothing is selected.
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

    // When no enabled provider exists at all, the trigger doubles as a CTA
    // to Settings → Providers (the host component routes the click). When
    // providers exist but no model is selected yet, show a neutral hint.
    const placeholder = hasEnabledProvider ? 'Select model…' : 'Add a provider →';

    // Suppress the provider badge when the model id ALREADY makes the
    // source clear (e.g. `deepseek-v4-pro` doesn't need an `OPENAI`
    // prefix even when the user named their OpenAI-compatible endpoint
    // "OpenAI"). Heuristic: hide the badge when the provider name is a
    // case-insensitive substring of the model id, or when the first
    // dash-segment of the model id matches the provider name. The full
    // provider context stays available via the `title` tooltip and the
    // open picker panel. Mixed-case rendering replaces the prior
    // shouting `uppercase tracking-wider`.
    const providerName = provider?.name ?? '';
    const modelId = value?.modelId ?? '';
    const showProviderBadge = (() => {
      if (!provider) return false;
      const pn = providerName.toLowerCase().trim();
      const m = modelId.toLowerCase();
      if (pn.length === 0) return false;
      if (m.includes(pn)) return false;
      const firstSeg = m.split(/[-/_]/)[0] ?? '';
      if (firstSeg.length > 0 && firstSeg === pn) return false;
      return true;
    })();

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
          'h-[1.625rem] min-w-0 max-w-[190px] items-center gap-1 px-1.5 text-chat-meta text-text-secondary'
        )}
      >
        {showProviderBadge && (
          <span className="vx-caption shrink-0 rounded-line border border-border-subtle/70 px-1 py-0.5 font-normal">
            {provider!.name}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate font-mono">
          {value?.modelId ?? placeholder}
        </span>
        <ChevronDown
          className={cn(
            SHELL_COMPACT_ICON_CLASS,
            'transition-transform duration-150',
            open && 'rotate-180'
          )}
          strokeWidth={SHELL_COMPACT_ICON_STROKE}
          aria-hidden
        />
      </button>
    );
  }
);
