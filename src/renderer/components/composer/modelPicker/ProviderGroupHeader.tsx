/**
 * Provider sub-header inside Local / Cloud catalog sections.
 */

import { useState } from 'react';
import { AlertTriangle, RefreshCcw, X } from 'lucide-react';
import type { ProviderConfig } from '@shared/types/provider.js';
import { useProviderStore } from '../../../store/useProviderStore.js';
import { cn } from '../../../lib/cn.js';
import {
  SHELL_ACTION_ICON_STROKE,
  SHELL_ROW_ICON_CLASS
} from '../../../lib/shellIcons.js';

interface ProviderGroupHeaderProps {
  provider: ProviderConfig;
  modelCount: number;
}

export function ProviderGroupHeader({ provider, modelCount }: ProviderGroupHeaderProps) {
  const discover = useProviderStore((s) => s.discover);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalDiscovered = provider.models?.length ?? 0;
  const status = error ? 'error' : totalDiscovered > 0 ? 'ready' : 'empty';

  const onRefresh = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setBusy(true);
    setError(null);
    try {
      await discover(provider.id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="vx-model-picker-provider-head group/head flex flex-col gap-0.5 pb-0.5 pt-1">
      <div className="flex min-w-0 items-center gap-1">
        {status !== 'ready' && (
          <span
            className={cn(
              'inline-flex shrink-0 items-center justify-center',
              SHELL_ROW_ICON_CLASS,
              status === 'error' ? 'text-danger' : 'text-warning'
            )}
            title={status === 'error' ? 'Model refresh failed' : 'No models discovered yet'}
          >
            {status === 'error' ? (
              <X className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
            ) : (
              <AlertTriangle className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
            )}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-meta font-medium text-text-faint">
          {provider.name}
        </span>
        <span className="shrink-0 font-mono text-meta tabular-nums text-text-faint">
          {modelCount}
        </span>
        <button
          type="button"
          onClick={(e) => void onRefresh(e)}
          disabled={busy}
          aria-label={`Refresh ${provider.name} models`}
          title="Refresh /v1/models"
          className={cn(
            'vx-btn vx-btn-quiet inline-flex h-4 w-4 shrink-0 items-center justify-center px-0',
            'text-text-faint opacity-0 transition-opacity duration-150',
            'group-hover/head:opacity-100 hover:text-text-primary focus-visible:opacity-100',
            'disabled:cursor-not-allowed'
          )}
        >
          <RefreshCcw
            className={cn(SHELL_ROW_ICON_CLASS, busy && 'animate-spin')}
            strokeWidth={SHELL_ACTION_ICON_STROKE}
          />
        </button>
      </div>
      {error ? <div className="line-clamp-1 text-meta text-danger">{error}</div> : null}
    </div>
  );
}
