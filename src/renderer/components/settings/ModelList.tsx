import { useEffect, useState } from 'react';
import { RefreshCcw } from 'lucide-react';
import type { ModelInfo, ProviderDialect, ThinkingEffort } from '@shared/types/provider.js';
import {
  effortDisplayLabel,
  isThinkingCapableModel
} from '@shared/providers/thinkingEffort.js';
import { ThinkingEffortOptionList } from '../shared/ThinkingEffortOptionList.js';
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
  onThinkingClear
}: ModelListProps) {
  const [filter, setFilter] = useState('');
  const [effortEditModelId, setEffortEditModelId] = useState<string | null>(null);
  const visible = filter
    ? models.filter((m) => m.id.toLowerCase().includes(filter.toLowerCase()))
    : models;

  const hasThinkingModels =
    !!onThinkingChange &&
    visible.some((m) => isThinkingCapableModel(dialect, m.id));

  const showEffortPanel =
    hasThinkingModels &&
    !!effortEditModelId &&
    isThinkingCapableModel(dialect, effortEditModelId);
  const effortValue = effortEditModelId ? thinkingByModel?.[effortEditModelId] : undefined;

  useEffect(() => {
    if (!effortEditModelId) return;
    if (!visible.some((m) => m.id === effortEditModelId)) {
      setEffortEditModelId(null);
    }
  }, [visible, effortEditModelId]);

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
      <div className="flex min-h-0 gap-0">
        <div
          className={cn(
            'scrollbar-stealth max-h-48 min-w-0 overflow-y-auto',
            hasThinkingModels ? 'flex-1' : 'w-full'
          )}
        >
          {visible.map((m) => {
            const effortLabel = onThinkingChange
              ? effortDisplayLabel(thinkingByModel?.[m.id])
              : null;
            const canEditEffort =
              !!onThinkingChange && isThinkingCapableModel(dialect, m.id);
            const editing = effortEditModelId === m.id;

            return (
              <div
                key={m.id}
                role={canEditEffort ? 'button' : undefined}
                tabIndex={canEditEffort ? 0 : undefined}
                onClick={() => canEditEffort && setEffortEditModelId(m.id)}
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
                  {typeof m.contextWindow === 'number' && (
                    <span className="vx-caption">{formatTokenCount(m.contextWindow)} ctx</span>
                  )}
                </div>
              </div>
            );
          })}
          {visible.length === 0 && (
            <div className={chromeNoMatchesClassName}>No matches.</div>
          )}
        </div>
        {hasThinkingModels && (
          <aside className={cn(EFFORT_COLUMN_CLASS, 'flex min-h-0 flex-col')}>
            {showEffortPanel && effortEditModelId && onThinkingChange ? (
              <ThinkingEffortOptionList
                dialect={dialect}
                modelId={effortEditModelId}
                value={effortValue}
                onSelect={(effort) => onThinkingChange(effortEditModelId, effort)}
                onClear={() => onThinkingClear?.(effortEditModelId)}
              />
            ) : (
              <div className="flex flex-1 flex-col px-2.5 py-3">
                <div className="py-1 text-meta font-medium text-text-faint">Effort</div>
                <p className="text-meta leading-snug text-text-faint">
                  Click a model to configure effort.
                </p>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
