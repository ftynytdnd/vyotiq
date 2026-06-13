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
import { formatModelPricingDetail } from '@shared/providers/modelPricing.js';
import {
  formatProviderAccountLine,
  isProviderAccountLow,
  managementKeyDocsUrl,
  providerNeedsManagementKey
} from '../../../lib/formatProviderAccount.js';
import { useProviderAccountStore } from '../../../store/useProviderAccountStore.js';
import {
  rowDisplayModelId
} from './modelPickerDisplay.js';

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
  const accountSnapshot = useProviderAccountStore((s) => s.snapshotFor(provider.id));
  const accountLine = formatProviderAccountLine(accountSnapshot);
  const accountLow = isProviderAccountLow(accountSnapshot);
  const needsMgmtKey = providerNeedsManagementKey(accountSnapshot);
  const mgmtDocs = managementKeyDocsUrl(accountSnapshot?.hostKind);

  const onEffortSelect = (effort: ThinkingEffort) => {
    applyThinkingEffortChange(provider.id, modelId, effort, onChange, updateProvider);
  };

  const onEffortClear = () => {
    applyThinkingEffortClear(provider.id, modelId, onChange, updateProvider);
  };

  return (
    <aside
      className={cn('vx-model-picker-side-inner flex min-h-0 flex-col overflow-y-auto', className)}
      aria-label="Model options"
    >
      <div className="vx-model-picker-side-head sticky top-0 z-[1] border-b border-border-subtle/30 bg-surface-overlay px-2 py-1.5">
        <div className="min-w-0">
          <div
            className="truncate font-mono text-row leading-snug text-text-primary"
            title={modelId}
          >
            {rowDisplayModelId(modelId)}
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
            <span className="truncate text-meta text-text-faint">{provider.name}</span>
            {isSelected ? (
              <span className="vx-model-picker-side-selected shrink-0 font-mono text-meta text-accent">
                Active
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {thinkingCapable && levels.length > 0 ? (
        <div className="flex flex-col gap-1 px-2 py-1.5">
          <div className="text-meta font-medium text-text-faint">Effort</div>
          <div className="vx-model-picker-effort-grid flex flex-wrap gap-1">
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
        <div className="px-2 py-1.5">
          <div className="text-meta font-medium text-text-faint">Effort</div>
          <p className="mt-0.5 text-meta leading-snug text-text-faint">Not configurable</p>
        </div>
      )}

      {model?.pricing ? (
        <div className="border-t border-border-subtle/30 px-2 py-1.5">
          <div className="text-meta font-medium text-text-faint">Pricing</div>
          <p className="mt-0.5 font-mono text-meta leading-snug text-text-secondary">
            {formatModelPricingDetail(model.pricing)}
          </p>
        </div>
      ) : null}

      {accountLine || needsMgmtKey ? (
        <div className="border-t border-border-subtle/30 px-2 py-1.5">
          <div className="text-meta font-medium text-text-faint">Account</div>
          {accountLine ? (
            <p
              className={cn(
                'mt-0.5 font-mono text-meta leading-snug tabular-nums',
                accountLow ? 'text-warning' : 'text-text-secondary'
              )}
            >
              {accountLine}
            </p>
          ) : null}
          {needsMgmtKey ? (
            <p className="mt-0.5 text-meta leading-snug text-text-faint">
              Management key required for account credits.
              {mgmtDocs ? (
                <>
                  {' '}
                  <a
                    href={mgmtDocs}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent underline-offset-2 hover:underline"
                  >
                    Docs
                  </a>
                </>
              ) : null}
            </p>
          ) : null}
        </div>
      ) : null}

      <ContextOverrideEditor
        modelId={modelId}
        discovered={model?.contextWindow}
        discoveredEstimated={model?.contextEstimated}
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
        className="border-t border-border-subtle/30 py-1.5"
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
        'vx-model-picker-effort-chip rounded-md border px-1.5 py-0.5 font-mono text-meta transition-colors',
        selected
          ? 'border-accent/40 bg-accent-soft/35 font-medium text-text-primary'
          : 'border-border-subtle/40 bg-transparent text-text-faint hover:border-border-subtle hover:bg-chrome-hover-soft hover:text-text-secondary'
      )}
      data-active={selected ? 'true' : 'false'}
    >
      <span className="block max-w-[5.5rem] truncate">{label}</span>
    </button>
  );
}
