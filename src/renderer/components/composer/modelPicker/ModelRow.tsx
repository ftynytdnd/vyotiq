/**
 * Single model row: model id with optional effort label, context, favorite.
 * Pointer hover is CSS-only; effort panel follows click or keyboard focus.
 */

import { memo } from 'react';
import { Check, Star } from 'lucide-react';
import type { ModelInfo, ModelSelection, ProviderConfig } from '@shared/types/provider.js';
import { isThinkingCapableModel } from '@shared/providers/thinkingEffort.js';
import { cn } from '../../../lib/cn.js';
import {
  SHELL_ACTION_ICON_STROKE,
  SHELL_MICRO_ICON_CLASS,
  SHELL_MICRO_ICON_STROKE,
  SHELL_ROW_ICON_CLASS
} from '../../../lib/shellIcons.js';
import { formatTokenCount } from '../../../lib/formatTokens.js';
import {
  EMPTY_FAVORITE_MODELS,
  useSettingsStore
} from '../../../store/useSettingsStore.js';
import { rowEffortInlineLabel, rowThinkingEffort } from './modelPickerThinking.js';

interface ModelRowProps {
  provider: ProviderConfig;
  model: ModelInfo;
  selection: ModelSelection | null;
  selected: boolean;
  /** Arrow-key highlight (does not follow pointer hover). */
  keyboardFocused: boolean;
  /** Drives the effort side panel for this row. */
  effortActive: boolean;
  /** Pointer down on the row body — preview effort without selecting. */
  onActivate: () => void;
  onSelect: () => void;
}

export const ModelRow = memo(function ModelRow({
  provider,
  model,
  selection,
  selected,
  keyboardFocused,
  effortActive,
  onActivate,
  onSelect
}: ModelRowProps) {
  const favoriteKey = `${provider.id}::${model.id}`;
  const isFavorite = useSettingsStore((s) =>
    (s.settings.ui?.favoriteModels ?? EMPTY_FAVORITE_MODELS).includes(favoriteKey)
  );
  const toggleFavorite = useSettingsStore((s) => s.toggleFavoriteModel);

  const effortLabel = isThinkingCapableModel(provider.dialect, model.id)
    ? rowEffortInlineLabel(rowThinkingEffort(provider, model.id, selection))
    : null;

  const highlighted = keyboardFocused || effortActive;

  return (
    <div
      role="option"
      aria-selected={selected}
      className={cn(
        'vx-dropdown-item group flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1',
        'hover:bg-chrome-hover-soft',
        highlighted && 'bg-chrome-active'
      )}
      data-active={highlighted ? 'true' : 'false'}
    >
      <button
        type="button"
        aria-label={selected ? 'Selected model' : 'Select model'}
        onClick={onSelect}
        className="vx-btn vx-btn-quiet shrink-0 p-0"
      >
        <Check
          className={cn(
            SHELL_ROW_ICON_CLASS,
            selected ? 'text-accent' : 'opacity-0 group-hover:opacity-30'
          )}
          strokeWidth={SHELL_ACTION_ICON_STROKE}
        />
      </button>
      <button
        type="button"
        onClick={onActivate}
        className="flex min-w-0 flex-1 items-baseline gap-1.5 text-left"
      >
        <span
          className="min-w-0 truncate font-mono text-row leading-tight"
          title={model.id}
        >
          {model.id}
        </span>
        {effortLabel ? (
          <span className="shrink-0 text-meta text-text-faint">{effortLabel}</span>
        ) : null}
      </button>
      {typeof model.contextWindow === 'number' && model.contextWindow > 0 && (
        <span
          className="shrink-0 font-mono text-meta text-text-faint tabular-nums"
          title={`${model.contextWindow.toLocaleString()} token context`}
        >
          {formatTokenCount(model.contextWindow)}
        </span>
      )}
      <button
        type="button"
        aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        title={isFavorite ? 'Unfavorite' : 'Favorite'}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          void toggleFavorite(provider.id, model.id);
        }}
        className={cn(
          'vx-btn vx-btn-quiet shrink-0 px-0.5 py-0.5',
          isFavorite || highlighted
            ? 'opacity-100'
            : 'opacity-0 group-hover:opacity-100'
        )}
      >
        <Star
          className={cn(SHELL_MICRO_ICON_CLASS, isFavorite && 'fill-accent text-accent')}
          strokeWidth={SHELL_MICRO_ICON_STROKE}
        />
      </button>
    </div>
  );
});
