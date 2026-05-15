/**
 * ProviderGroupHeader - renders a provider name, status icon, and inline
 * `Refresh /v1/models` action.
 *
 * Status icon:
 *   - check: enabled + at least one model discovered
 *   - warning: enabled + zero models discovered yet
 *   - x: last refresh raised an error
 */

import { useState } from 'react';
import { AlertTriangle, Check, RefreshCcw, X } from 'lucide-react';
import type { ProviderConfig } from '@shared/types/provider.js';
import { Eyebrow } from '../../ui/Eyebrow.js';
import { useProviderStore } from '../../../store/useProviderStore.js';
import { cn } from '../../../lib/cn.js';

interface ProviderGroupHeaderProps {
  provider: ProviderConfig;
}

export function ProviderGroupHeader({ provider }: ProviderGroupHeaderProps) {
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
    <div className="flex flex-col gap-0.5 px-2 pb-1 pt-2">
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            'inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center',
            status === 'error'
              ? 'text-danger'
              : status === 'ready'
                ? 'text-success'
                : 'text-warning'
          )}
          title={
            status === 'error'
              ? 'Model refresh failed'
              : status === 'ready'
                ? `${totalDiscovered} model${totalDiscovered === 1 ? '' : 's'} available`
                : 'No models discovered yet'
          }
        >
          {status === 'error' ? (
            <X className="h-3 w-3" strokeWidth={2.25} />
          ) : status === 'ready' ? (
            <Check className="h-3 w-3" strokeWidth={2.25} />
          ) : (
            <AlertTriangle className="h-3 w-3" strokeWidth={2.25} />
          )}
        </span>
        <Eyebrow as="span" bold className="flex-1 truncate">
          {provider.name}
        </Eyebrow>
        <button
          type="button"
          onClick={(e) => void onRefresh(e)}
          disabled={busy}
          aria-label={`Refresh ${provider.name} models`}
          title="Refresh /v1/models"
          className={cn(
            'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded',
            'text-text-faint transition-colors duration-150',
            'hover:text-text-primary disabled:cursor-not-allowed'
          )}
        >
          <RefreshCcw
            className={cn('h-3 w-3', busy && 'animate-spin')}
            strokeWidth={2.25}
          />
        </button>
      </div>
      {error && (
        <div className="ml-5 line-clamp-2 text-meta text-danger">{error}</div>
      )}
    </div>
  );
}
