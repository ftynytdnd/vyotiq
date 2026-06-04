/**
 * Single model row in the picker panel. Renders the model id (monospace),
 * a check icon for the currently-selected model, and an optional
 * discovered context-window label when the provider reported one.
 */

import { memo } from 'react';
import { Check, Star } from 'lucide-react';
import type { ModelInfo } from '@shared/types/provider.js';
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

interface ModelRowProps {
  providerId: string;
  model: ModelInfo;
  selected: boolean;
  focused: boolean;
  onSelect: () => void;
  onMouseEnter?: () => void;
}

export const ModelRow = memo(function ModelRow({
  providerId,
  model,
  selected,
  focused,
  onSelect,
  onMouseEnter
}: ModelRowProps) {
  const favoriteKey = `${providerId}::${model.id}`;
  const isFavorite = useSettingsStore((s) =>
    (s.settings.ui?.favoriteModels ?? EMPTY_FAVORITE_MODELS).includes(favoriteKey)
  );
  const toggleFavorite = useSettingsStore((s) => s.toggleFavoriteModel);

  return (
    <div
      role="option"
      aria-selected={selected}
      onMouseEnter={onMouseEnter}
      className="vx-dropdown-item group flex w-full items-center gap-2"
      data-active={focused || selected ? 'true' : 'false'}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <Check
          className={cn(
            SHELL_ROW_ICON_CLASS,
            selected ? 'text-accent' : 'opacity-0'
          )}
          strokeWidth={SHELL_ACTION_ICON_STROKE}
        />
        <span className="min-w-0 flex-1 truncate font-mono" title={model.id}>
          {model.id}
        </span>
      </button>
      <button
        type="button"
        aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        title={isFavorite ? 'Unfavorite' : 'Favorite'}
        onClick={(e) => {
          e.stopPropagation();
          void toggleFavorite(providerId, model.id);
        }}
        className="vx-btn vx-btn-quiet shrink-0 px-0.5 py-0.5 opacity-0 group-hover:opacity-100 data-[fav=true]:opacity-100"
        data-fav={isFavorite ? 'true' : 'false'}
      >
        <Star
          className={cn(SHELL_MICRO_ICON_CLASS, isFavorite && 'fill-accent text-accent')}
          strokeWidth={SHELL_MICRO_ICON_STROKE}
        />
      </button>
      {typeof model.contextWindow === 'number' && model.contextWindow > 0 && (
        <span
          className="shrink-0 font-mono text-meta text-text-faint tabular-nums"
          title={`${model.contextWindow.toLocaleString()} token context window (from provider)`}
        >
          {formatTokenCount(model.contextWindow)}
        </span>
      )}
    </div>
  );
});
