import { useState } from 'react';
import { RefreshCcw } from 'lucide-react';
import type { ModelInfo, ProviderDialect, ThinkingEffort } from '@shared/types/provider.js';
import {
  supportedThinkingEfforts,
  THINKING_EFFORT_LABELS
} from '@shared/providers/thinkingEffort.js';
import { Button } from '../ui/Button.js';
import { LoadingHint } from '../ui/LoadingHint.js';
import { TextField } from '../ui/TextField.js';
import { formatTokenCount } from '../../lib/formatTokens.js';
import { ShellCaption } from '../ui/ShellSection.js';
import { chromeNoMatchesClassName } from '../ui/SurfaceShell.js';
import { SHELL_ROW_ICON_CLASS, SHELL_ROW_ICON_STROKE } from '../../lib/shellIcons.js';

interface ModelListProps {
  models: ModelInfo[];
  loading?: boolean;
  emptyMessage?: string;
  /**
   * Optional inline call-to-action. When supplied, the empty state
   * renders a Discover-models button that fires this callback —
   * removing the need to scan upward and find the same action in the
   * card's button row. Disabled while another discovery / test is in
   * flight on the parent card.
   */
  onDiscover?: () => void;
  discoverDisabled?: boolean;
  /**
   * Provider dialect — drives which thinking-effort levels each model
   * row offers. When omitted, no per-model thinking control renders.
   */
  dialect?: ProviderDialect;
  /** Stored per-model thinking-effort overrides, keyed by `modelId`. */
  thinkingByModel?: Record<string, ThinkingEffort>;
  /** Persist a per-model thinking-effort change. */
  onThinkingChange?: (modelId: string, effort: ThinkingEffort) => void;
}

export function ModelList({
  models,
  loading,
  emptyMessage,
  onDiscover,
  discoverDisabled,
  dialect,
  thinkingByModel,
  onThinkingChange
}: ModelListProps) {
  const [filter, setFilter] = useState('');
  const visible = filter
    ? models.filter((m) => m.id.toLowerCase().includes(filter.toLowerCase()))
    : models;

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
      <div className="scrollbar-stealth max-h-48 overflow-y-auto">
        {visible.map((m) => (
          <div
            key={m.id}
            className="flex items-center justify-between gap-2 rounded-line px-1 py-0.5 transition-colors hover:bg-chrome-hover-soft vx-model-list-row"
          >
            <span className="truncate font-mono text-text-secondary">{m.id}</span>
            <div className="flex shrink-0 items-center gap-2">
              {typeof m.contextWindow === 'number' && (
                <span className="vx-caption">{formatTokenCount(m.contextWindow)} ctx</span>
              )}
              {onThinkingChange && (
                <ThinkingEffortSelect
                  dialect={dialect}
                  modelId={m.id}
                  value={thinkingByModel?.[m.id]}
                  onChange={(effort) => onThinkingChange(m.id, effort)}
                />
              )}
            </div>
          </div>
        ))}
        {visible.length === 0 && (
          <div className={chromeNoMatchesClassName}>No matches.</div>
        )}
      </div>
    </div>
  );
}

/**
 * Compact per-model "thinking effort" picker. A native `<select>` keeps
 * it robust inside the scrollable model list (a popover dropdown would
 * clip against `overflow-y-auto`). Offers only the levels the model's
 * dialect supports; the leading "Default" entry represents "no override
 * stored" (the provider's natural behavior).
 */
function ThinkingEffortSelect({
  dialect,
  modelId,
  value,
  onChange
}: {
  dialect?: ProviderDialect;
  modelId: string;
  value: ThinkingEffort | undefined;
  onChange: (effort: ThinkingEffort) => void;
}) {
  const levels = supportedThinkingEfforts(dialect, modelId);
  return (
    <select
      className="vx-input h-6 max-w-[7.5rem] py-0 text-meta"
      value={value ?? ''}
      title="Thinking effort"
      aria-label={`Thinking effort for ${modelId}`}
      onChange={(e) => onChange(e.target.value as ThinkingEffort)}
    >
      <option value="" disabled>
        Default
      </option>
      {levels.map((lvl) => (
        <option key={lvl} value={lvl}>
          {THINKING_EFFORT_LABELS[lvl]}
        </option>
      ))}
    </select>
  );
}
