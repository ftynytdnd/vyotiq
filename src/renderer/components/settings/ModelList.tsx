import { useEffect, useState } from 'react';
import { RefreshCcw } from 'lucide-react';
import type { ModelInfo, ProviderDialect, ThinkingEffort } from '@shared/types/provider.js';
import {
  effortDisplayLabel,
  isThinkingCapableModel,
  type ThinkingCapabilityOptions
} from '@shared/providers/thinkingEffort.js';
import { ContextOverrideEditor } from '../shared/ContextOverrideEditor.js';
import { ThinkingEffortOptionList } from '../shared/ThinkingEffortOptionList.js';
import { effectiveContextWindow } from '@shared/providers/contextWindow.js';
import { Button } from '../ui/Button.js';
import { LoadingHint } from '../ui/LoadingHint.js';
import { TextField } from '../ui/TextField.js';
import { formatTokenCount } from '../../lib/formatTokens.js';
import { ShellCaption } from '../ui/ShellSection.js';
import { chromeNoMatchesClassName } from '../ui/SurfaceShell.js';
import { cn } from '../../lib/cn.js';
import { SHELL_ROW_ICON_CLASS, SHELL_ROW_ICON_STROKE } from '../../lib/shellIcons.js';

const EFFORT_COLUMN_CLASS = 'w-[9.75rem] shrink-0 border-l border-border-subtle/30';

interface ModelListProps {
  models: ModelInfo[];
  loading?: boolean;
  emptyMessage?: string;
  onDiscover?: () => void;
  discoverDisabled?: boolean;
  dialect?: ProviderDialect;
  thinkingByModel?: Record<string, ThinkingEffort>;
  onThinkingChange?: (modelId: string, effort: ThinkingEffort) => void;
  onThinkingClear?: (modelId: string) => void;
  contextOverrides?: Record<string, number>;
  onContextOverrideSave?: (modelId: string, tokens: number) => void;
  onContextOverrideClear?: (modelId: string) => void;
}

export function ModelList({
  models,
  loading,
  emptyMessage,
  onDiscover,
  discoverDisabled,
  dialect,
  thinkingByModel,
  onThinkingChange,
  onThinkingClear,
  contextOverrides,
  onContextOverrideSave,
  onContextOverrideClear
}: ModelListProps) {
  const [filter, setFilter] = useState('');
  const [effortEditModelId, setEffortEditModelId] = useState<string | null>(null);
  const [contextEditModelId, setContextEditModelId] = useState<string | null>(null);
  const visible = filter
    ? models.filter((m) => m.id.toLowerCase().includes(filter.toLowerCase()))
    : models;

  const thinkingCapOpts = (m: ModelInfo): ThinkingCapabilityOptions => ({
    supportedParameters: m.supportedParameters,
    thinking: m.thinking
  });
  const hasThinkingModels =
    !!onThinkingChange &&
    visible.some((m) => isThinkingCapableModel(dialect, m.id, thinkingCapOpts(m)));

  const showEffortPanel =
    hasThinkingModels &&
    !!effortEditModelId &&
    isThinkingCapableModel(
      dialect,
      effortEditModelId,
      thinkingCapOpts(models.find((m) => m.id === effortEditModelId) ?? { id: effortEditModelId, thinking: undefined })
    );
  const effortValue = effortEditModelId ? thinkingByModel?.[effortEditModelId] : undefined;
  const showContextPanel = !!contextEditModelId && !!onContextOverrideSave;
  const contextEditModel = contextEditModelId
    ? models.find((m) => m.id === contextEditModelId)
    : undefined;

  useEffect(() => {
    if (!effortEditModelId) return;
    if (!visible.some((m) => m.id === effortEditModelId)) {
      setEffortEditModelId(null);
    }
  }, [visible, effortEditModelId]);

  const showOptionsAside = hasThinkingModels || !!onContextOverrideSave;
  const optionsPanelActive = showEffortPanel || showContextPanel;

  if (loading) {
    return (
      <div className="flex items-center gap-2 vx-caption">
        <LoadingHint message="Discovering models…" className="py-4" />
      </div>
    );
  }
  if (models.length === 0) {
    return (
      <div className="flex flex-col items-start gap-2">
        <ShellCaption>{emptyMessage ?? 'No models discovered yet.'}</ShellCaption>
        {onDiscover && (
          <Button variant="secondary" onClick={onDiscover} disabled={discoverDisabled}>
            <RefreshCcw className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} />
            Discover models
          </Button>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <TextField
        className="w-full"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder={`Filter ${models.length} models…`}
      />
      {showOptionsAside && !optionsPanelActive ? (
        <ShellCaption className="px-0.5">
          Click a model row or its context badge to configure.
        </ShellCaption>
      ) : null}
      <div className="flex min-h-0 gap-0">
        <div
          className={cn(
            'scrollbar-stealth max-h-56 min-w-0 overflow-y-auto',
            showOptionsAside && optionsPanelActive ? 'flex-1' : 'w-full'
          )}
        >
          {visible.map((m) => {
            const effortLabel = onThinkingChange
              ? effortDisplayLabel(thinkingByModel?.[m.id])
              : null;
            const canEditEffort =
              !!onThinkingChange && isThinkingCapableModel(dialect, m.id, thinkingCapOpts(m));
            const editing = effortEditModelId === m.id;

            return (
              <div
                key={m.id}
                role={canEditEffort ? 'button' : undefined}
                tabIndex={canEditEffort ? 0 : undefined}
                onClick={() => {
                  if (canEditEffort) {
                    setEffortEditModelId(m.id);
                    setContextEditModelId(null);
                  }
                }}
                onKeyDown={(e) => {
                  if (canEditEffort && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    setEffortEditModelId(m.id);
                  }
                }}
                className={cn(
                  'vx-model-list-row flex items-center justify-between gap-2 rounded-line px-1 py-0.5',
                  canEditEffort && 'cursor-pointer hover:bg-chrome-hover-soft',
                  editing && 'bg-chrome-active'
                )}
              >
                <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
                  <span className="truncate font-mono text-text-secondary">{m.id}</span>
                  {effortLabel ? (
                    <span className="shrink-0 text-meta text-text-faint">{effortLabel}</span>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {onContextOverrideSave ? (
                    <button
                      type="button"
                      className={cn(
                        'vx-caption rounded px-1 hover:bg-chrome-hover-soft',
                        contextEditModelId === m.id && 'bg-chrome-active'
                      )}
                      onClick={(e) => {
                        e.stopPropagation();
                        setContextEditModelId(m.id);
                        setEffortEditModelId(null);
                      }}
                    >
                      {(() => {
                        const ctx = effectiveContextWindow(m, contextOverrides);
                        return typeof ctx === 'number'
                          ? `${formatTokenCount(ctx)} ctx`
                          : 'Set ctx';
                      })()}
                    </button>
                  ) : (() => {
                      const ctx = effectiveContextWindow(m, contextOverrides);
                      return typeof ctx === 'number' ? (
                        <span className="vx-caption">{formatTokenCount(ctx)} ctx</span>
                      ) : null;
                    })()}
                </div>
              </div>
            );
          })}
          {visible.length === 0 && (
            <div className={chromeNoMatchesClassName}>No matches.</div>
          )}
        </div>
        {(showEffortPanel && effortEditModelId && onThinkingChange) ||
        (showContextPanel && contextEditModelId && contextEditModel && onContextOverrideSave) ? (
          <aside className={cn(EFFORT_COLUMN_CLASS, 'scrollbar-stealth flex min-h-0 flex-col overflow-y-auto')}>
            {showEffortPanel && effortEditModelId && onThinkingChange ? (
              <ThinkingEffortOptionList
                dialect={dialect}
                modelId={effortEditModelId}
                supportedParameters={
                  models.find((m) => m.id === effortEditModelId)?.supportedParameters
                }
                thinking={models.find((m) => m.id === effortEditModelId)?.thinking}
                value={effortValue}
                onSelect={(effort) => onThinkingChange(effortEditModelId, effort)}
                onClear={() => onThinkingClear?.(effortEditModelId)}
              />
            ) : showContextPanel && contextEditModelId && contextEditModel && onContextOverrideSave ? (
              <ContextOverrideEditor
                modelId={contextEditModelId}
                discovered={contextEditModel.contextWindow}
                override={contextOverrides?.[contextEditModelId]}
                onSave={(tokens) => onContextOverrideSave(contextEditModelId, tokens)}
                onClear={() => onContextOverrideClear?.(contextEditModelId)}
              />
            ) : null}
          </aside>
        ) : null}
      </div>
    </div>
  );
}
