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
        title={tooltip}
        className={cn(
          // `text-row` (11px) on the trigger, not `text-meta` (10px) —
          // the model id is the only one of the composer's pill
          // controls that holds arbitrary user-supplied text, and
          // 10px was painfully small for long ids (`claude-sonnet-
          // 4-5-20250929-thinking`). Sibling permission / attach /
          // send buttons stay at `text-meta` because their labels
          // are fixed-width app-controlled. The trigger pill height
          // (`h-6`) is unchanged.
          'app-no-drag inline-flex h-6 min-w-0 max-w-[190px] items-center gap-1 rounded-inner px-1.5 text-row',
          'bg-surface-overlay text-text-secondary transition-colors duration-150',
          'hover:bg-surface-hover hover:text-text-primary',
          open && 'bg-surface-hover text-text-primary'
        )}
      >
        {showProviderBadge && (
          <span className="shrink-0 rounded-inner bg-surface-base px-1 py-0.5 text-meta text-text-faint">
            {provider!.name}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate font-mono">
          {value?.modelId ?? placeholder}
        </span>
        <ChevronDown
          className={cn(
            'h-3 w-3 shrink-0 transition-transform duration-150',
            open && 'rotate-180'
          )}
          strokeWidth={2.25}
        />
      </button>
    );
  }
);
