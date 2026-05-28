import { useState } from 'react';
import { RefreshCcw } from 'lucide-react';
import type { ModelInfo } from '@shared/types/provider.js';
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
}

export function ModelList({ models, loading, emptyMessage, onDiscover, discoverDisabled }: ModelListProps) {
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
            className="flex items-center justify-between rounded-line px-1 py-0.5 transition-colors hover:bg-chrome-hover-soft vx-model-list-row"
          >
            <span className="truncate font-mono text-text-secondary">{m.id}</span>
            {typeof m.contextWindow === 'number' && (
              <span className="shrink-0 vx-caption">{formatTokenCount(m.contextWindow)} ctx</span>
            )}
          </div>
        ))}
        {visible.length === 0 && (
          <div className={chromeNoMatchesClassName}>No matches.</div>
        )}
      </div>
    </div>
  );
}
