import { useState } from 'react';
import { RefreshCcw } from 'lucide-react';
import type { ModelInfo } from '@shared/types/provider.js';
import { Button } from '../ui/Button.js';
import { Spinner } from '../ui/Spinner.js';
import { TextField } from '../ui/TextField.js';
import { formatTokenCount } from '../../lib/formatTokens.js';

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
      <div className="flex items-center gap-2 text-row text-text-muted">
        <Spinner /> Discovering models…
      </div>
    );
  }
  if (models.length === 0) {
    return (
      <div className="flex flex-col items-start gap-2 text-row text-text-muted">
        <span>{emptyMessage ?? 'No models discovered yet.'}</span>
        {onDiscover && (
          <Button
            size="sm"
            variant="secondary"
            onClick={onDiscover}
            disabled={discoverDisabled}
          >
            <RefreshCcw className="h-3.5 w-3.5" strokeWidth={2.25} />
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
      <div className="max-h-48 overflow-y-auto rounded-inner bg-surface-base">
        {visible.map((m) => (
          <div
            key={m.id}
            className="flex items-center justify-between px-2.5 py-1.5 text-row text-text-secondary"
          >
            <span className="truncate font-mono">{m.id}</span>
            {typeof m.contextWindow === 'number' && (
              <span className="text-text-faint">
                {formatTokenCount(m.contextWindow)} ctx
              </span>
            )}
          </div>
        ))}
        {visible.length === 0 && (
          <div className="px-2.5 py-2 text-row text-text-muted">No matches.</div>
        )}
      </div>
    </div>
  );
}
