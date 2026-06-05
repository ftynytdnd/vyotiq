/**
 * Compact effort + context sidebar for the composer model picker.
 */

import type {
  ModelInfo,
  ModelSelection,
  ProviderConfig,
  ThinkingEffort
} from '@shared/types/provider.js';
import {
  isThinkingCapableModel,
  supportedThinkingEfforts,
  THINKING_EFFORT_LABELS
} from '@shared/providers/thinkingEffort.js';
import { ContextOverrideEditor } from '../../shared/ContextOverrideEditor.js';
import { cn } from '../../../lib/cn.js';
import type { useProviderStore } from '../../../store/useProviderStore.js';
import {
  applyContextOverrideChange,
  applyContextOverrideClear
} from './modelPickerContext.js';
import {
  applyThinkingEffortChange,
  applyThinkingEffortClear,
  rowThinkingEffort
} from './modelPickerThinking.js';
import { rowDisplayModelId } from './modelPickerDisplay.js';

type UpdateProvider = ReturnType<typeof useProviderStore.getState>['update'];

interface ModelPickerSidePanelProps {
  provider: ProviderConfig;
  modelId: string;
  model: ModelInfo | undefined;
  selection: ModelSelection | null;
  isSelected: boolean;
  onChange: (selection: ModelSelection) => void;
  updateProvider: UpdateProvider;
  makeSelection: (providerId: string, modelId: string) => ModelSelection;
  className?: string;
}

export function ModelPickerSidePanel({
  provider,
  modelId,
  model,
  selection,
  isSelected,
  onChange,
  updateProvider,
  makeSelection,
  className
}: ModelPickerSidePanelProps) {
  const capOpts = {
    supportedParameters: model?.supportedParameters,
    thinking: model?.thinking
  };
  const thinkingCapable = isThinkingCapableModel(provider.dialect, modelId, capOpts);
  const effortValue = rowThinkingEffort(provider, modelId, selection);
  const levels = thinkingCapable
    ? supportedThinkingEfforts(provider.dialect, modelId, capOpts)
    : [];

  const onEffortSelect = (effort: ThinkingEffort) => {
    applyThinkingEffortChange(provider.id, modelId, effort, onChange, updateProvider);
  };

  const onEffortClear = () => {
    applyThinkingEffortClear(provider.id, modelId, onChange, updateProvider);
  };

  return (
    <aside
      className={cn('flex min-h-0 flex-col overflow-y-auto', className)}
      aria-label="Model options"
    >
      <div className="sticky top-0 z-[1] border-b border-border-subtle/30 bg-surface-overlay px-2.5 py-2">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="font-mono text-row leading-snug break-all" title={modelId}>
              {rowDisplayModelId(modelId)}
            </div>
            <div className="mt-0.5 truncate text-meta text-text-faint">{provider.name}</div>
          </div>
          <span
            className={cn(
              'vx-caption shrink-0 rounded-line px-1.5 py-0.5',
              isSelected ? 'bg-accent-soft text-accent' : 'bg-chrome-hover-soft text-text-faint'
            )}
          >
            {isSelected ? 'Selected' : 'Preview'}
          </span>
        </div>
      </div>

      {thinkingCapable && levels.length > 0 ? (
        <div className="flex flex-col gap-1 px-2.5 py-2">
          <div className="text-meta font-medium text-text-faint">Effort</div>
          <div className="flex flex-col gap-px">
            <EffortChip
              label="Default"
              selected={effortValue === undefined}
              onClick={onEffortClear}
            />
            {levels.map((lvl) => (
              <EffortChip
                key={lvl}
                label={THINKING_EFFORT_LABELS[lvl]}
                selected={effortValue === lvl}
                onClick={() => onEffortSelect(lvl)}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="px-2.5 py-2">
          <div className="text-meta font-medium text-text-faint">Effort</div>
          <p className="mt-0.5 text-meta leading-snug text-text-faint">
            No thinking effort for this model.
          </p>
        </div>
      )}

      <ContextOverrideEditor
        modelId={modelId}
        discovered={model?.contextWindow}
        override={provider.contextOverrides?.[modelId]}
        mode="auto"
        compact
        onSave={(tokens) => {
          applyContextOverrideChange(provider.id, modelId, tokens, updateProvider);
          onChange(makeSelection(provider.id, modelId));
        }}
        onClear={() => {
          applyContextOverrideClear(provider.id, modelId, updateProvider);
          onChange(makeSelection(provider.id, modelId));
        }}
        className="border-t border-border-subtle/30 py-2"
      />
    </aside>
  );
}

function EffortChip({
  label,
  selected,
  onClick
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'vx-dropdown-item w-full rounded-md px-2 py-1 text-left text-meta transition-colors',
        'hover:bg-chrome-hover-soft',
        selected && 'bg-chrome-active font-medium text-text-primary'
      )}
      data-active={selected ? 'true' : 'false'}
    >
      <span className="block truncate">{label}</span>
    </button>
  );
}
