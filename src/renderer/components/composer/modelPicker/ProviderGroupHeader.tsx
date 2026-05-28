/**
 * ProviderGroupHeader - renders a provider name, status icon, and inline
 * `Refresh /v1/models` action.
 *
 * Status icon (error-only when healthy):
 *   - hidden: enabled + models discovered + no refresh error
 *   - warning: enabled + zero models discovered yet
 *   - x: last refresh raised an error
 */

import { useState } from 'react';
import { AlertTriangle, RefreshCcw, X } from 'lucide-react';
import type { ProviderConfig } from '@shared/types/provider.js';
import { Eyebrow } from '../../ui/Eyebrow.js';
import { useProviderStore } from '../../../store/useProviderStore.js';
import { cn } from '../../../lib/cn.js';
import {
  SHELL_ACTION_ICON_STROKE,
  SHELL_ROW_ICON_CLASS
} from '../../../lib/shellIcons.js';

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
        {status !== 'ready' && (
          <span
            className={cn(
              'inline-flex shrink-0 items-center justify-center',
              SHELL_ROW_ICON_CLASS,
              status === 'error' ? 'text-danger' : 'text-warning'
            )}
            title={
              status === 'error'
                ? 'Model refresh failed'
                : 'No models discovered yet'
            }
          >
            {status === 'error' ? (
              <X className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
            ) : (
              <AlertTriangle className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
            )}
          </span>
        )}
        <Eyebrow as="span" bold className="vx-field-label flex-1 truncate normal-case tracking-normal">
          {provider.name}
        </Eyebrow>
        <button
          type="button"
          onClick={(e) => void onRefresh(e)}
          disabled={busy}
          aria-label={`Refresh ${provider.name} models`}
          title="Refresh /v1/models"
          className={cn(
            'vx-btn vx-btn-quiet inline-flex h-4 w-4 shrink-0 items-center justify-center px-0',
            'text-text-faint transition-colors duration-150',
            'hover:text-text-primary disabled:cursor-not-allowed'
          )}
        >
          <RefreshCcw
            className={cn(SHELL_ROW_ICON_CLASS, busy && 'animate-spin')}
            strokeWidth={SHELL_ACTION_ICON_STROKE}
          />
        </button>
      </div>
      {error && (
        <div className="line-clamp-2 text-meta text-danger">{error}</div>
      )}
    </div>
  );
}
