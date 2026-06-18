/**
 * Model list row — uniform columns: check | id | effort | ctx | star.
 */

import { memo } from 'react';
import { Check, Star } from 'lucide-react';
import type { ModelInfo, ModelSelection, ProviderConfig } from '@shared/types/provider.js';
import { isThinkingCapableModel } from '@shared/providers/thinkingEffort.js';
import { modelSupportsVision, modelSupportsAudioNative } from '@shared/providers/visionCapabilities.js';
import { cn } from '../../../lib/cn.js';
import {
  SHELL_ACTION_ICON_STROKE,
  SHELL_MICRO_ICON_CLASS,
  SHELL_MICRO_ICON_STROKE,
  SHELL_ROW_ICON_CLASS
} from '../../../lib/shellIcons.js';
import {
  EMPTY_FAVORITE_MODELS,
  useSettingsStore
} from '../../../store/useSettingsStore.js';
import { rowContextTokens } from './modelPickerContext.js';
import {
  rowContextBadgeLabel,
  rowDisplayModelId,
  shouldShowEffortBadge
} from './modelPickerDisplay.js';
import { formatModelPricingBadge } from '@shared/providers/modelPricing.js';
import { rowEffortInlineLabel, rowThinkingEffort } from './modelPickerThinking.js';

interface ModelRowProps {
  provider: ProviderConfig;
  model: ModelInfo;
  selection: ModelSelection | null;
  selected: boolean;
  keyboardFocused: boolean;
  effortActive: boolean;
  /** Provider subtitle under model id (Recent / Favorites). */
  showProviderName?: boolean;
  onPreview?: () => void;
  onSelect: () => void;
}

export const ModelRow = memo(function ModelRow({
  provider,
  model,
  selection,
  selected,
  keyboardFocused,
  effortActive,
  showProviderName = false,
  onPreview,
  onSelect
}: ModelRowProps) {
  const favoriteKey = `${provider.id}::${model.id}`;
  const isFavorite = useSettingsStore((s) =>
    (s.settings.ui?.favoriteModels ?? EMPTY_FAVORITE_MODELS).includes(favoriteKey)
  );
  const toggleFavorite = useSettingsStore((s) => s.toggleFavoriteModel);

  const thinkingCapable = isThinkingCapableModel(provider.dialect, model.id, {
    supportedParameters: model.supportedParameters,
    thinking: model.thinking
  });
  const effort = thinkingCapable
    ? rowThinkingEffort(provider, model.id, selection)
    : undefined;
  const effortLabel = shouldShowEffortBadge(effort, thinkingCapable)
    ? rowEffortInlineLabel(effort)
    : null;

  const ctx = rowContextTokens(model, provider);
  const ctxLabel =
    typeof ctx === 'number' && ctx > 0
      ? rowContextBadgeLabel(ctx, model.contextEstimated === true)
      : null;

  const priceLabel = formatModelPricingBadge(model.pricing);
  const visionCapable = modelSupportsVision(model.inputModalities);
  const audioCapable = modelSupportsAudioNative(model.inputModalities);

  const highlighted = keyboardFocused || effortActive;
  const displayId = rowDisplayModelId(model.id);
  const selectLabel = selected
    ? `Selected: ${model.id}${showProviderName ? ` (${provider.name})` : ''}`
    : `Select ${model.id}${showProviderName ? ` (${provider.name})` : ''}`;

  return (
    <div
      role="option"
      aria-selected={selected}
      aria-label={selectLabel}
      onMouseEnter={onPreview}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      tabIndex={-1}
      className={cn(
        'vx-model-picker-row vx-dropdown-item group cursor-pointer rounded-md',
        'hover:bg-chrome-hover-soft',
        highlighted && 'bg-chrome-active'
      )}
      data-active={highlighted ? 'true' : 'false'}
    >
      <span className="vx-model-picker-row-check-slot" aria-hidden>
        <Check
          className={cn(
            'vx-model-picker-row-check',
            SHELL_ROW_ICON_CLASS,
            selected ? 'text-accent' : 'opacity-0 group-hover:opacity-30'
          )}
          strokeWidth={SHELL_ACTION_ICON_STROKE}
        />
      </span>
      <div className="vx-model-picker-row-label min-w-0">
        <span className="vx-model-picker-row-id truncate" title={model.id}>
          {displayId}
        </span>
        {showProviderName ? (
          <span className="vx-model-picker-row-provider truncate" title={provider.name}>
            {provider.name}
          </span>
        ) : null}
      </div>
      <span
        className="vx-model-picker-row-slot vx-model-picker-row-slot--price"
        title={priceLabel ? `Pricing (in/out per M tokens): ${priceLabel}` : undefined}
      >
        {priceLabel ? (
          <span className="vx-model-picker-row-badge tabular-nums">{priceLabel}</span>
        ) : null}
      </span>
      <span
        className="vx-model-picker-row-slot vx-model-picker-row-slot--effort"
        title={effortLabel ? `Thinking effort: ${effortLabel}` : undefined}
      >
        {visionCapable ? (
          <span className="vx-model-picker-row-badge" title="Vision input supported">
            Vision
          </span>
        ) : null}
        {audioCapable ? (
          <span className="vx-model-picker-row-badge" title="Audio input supported">
            Audio
          </span>
        ) : null}
        {effortLabel ? (
          <span className="vx-model-picker-row-badge tabular-nums">{effortLabel}</span>
        ) : null}
      </span>
      <span
        className="vx-model-picker-row-slot vx-model-picker-row-slot--ctx"
        title={ctx ? `${ctx.toLocaleString()} token context` : undefined}
      >
        {ctxLabel ? <span className="vx-model-picker-row-badge">{ctxLabel}</span> : null}
      </span>
      <span className="vx-model-picker-row-slot vx-model-picker-row-slot--star">
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
            'vx-btn vx-btn-quiet px-0.5 py-0.5',
            isFavorite || highlighted
              ? 'opacity-100'
              : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
          )}
        >
          <Star
            className={cn(SHELL_MICRO_ICON_CLASS, isFavorite && 'fill-accent text-accent')}
            strokeWidth={SHELL_MICRO_ICON_STROKE}
          />
        </button>
      </span>
    </div>
  );
});
