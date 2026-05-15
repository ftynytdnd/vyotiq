import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useProviderStore } from '../../store/useProviderStore.js';
import { ProviderRow } from './ProviderRow.js';
import { AddProviderForm } from './AddProviderForm.js';
import { Spinner } from '../ui/Spinner.js';
import { Button } from '../ui/Button.js';

export function ProvidersPanel() {
  const providers = useProviderStore((s) => s.providers);
  const loading = useProviderStore((s) => s.loading);
  const error = useProviderStore((s) => s.error);
  const refresh = useProviderStore((s) => s.refresh);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="flex flex-col gap-4">
      <div className="text-row leading-relaxed text-text-muted">
        Add an OpenAI-compatible provider. Vyotiq calls{' '}
        <span className="font-mono text-text-secondary">GET /v1/models</span> to discover
        available models. Keys are encrypted via your OS keychain (Electron safeStorage).
      </div>

      {error && (
        <div className="flex items-start gap-2.5 border-l-2 border-danger/50 pl-3 pr-2 py-2">
          <AlertTriangle
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger"
            strokeWidth={2.25}
          />
          <div className="min-w-0 flex-1">
            <div className="text-row text-danger">Failed to load providers.</div>
            <div className="mt-0.5 break-words text-row text-text-muted">{error}</div>
          </div>
          <Button size="sm" variant="secondary" onClick={() => void refresh()}>
            Retry
          </Button>
        </div>
      )}

      <AddProviderForm />

      {loading && (
        <div className="flex items-center gap-2 text-row text-text-muted">
          <Spinner /> Loading providers…
        </div>
      )}

      <div className="flex flex-col divide-y divide-border-subtle/30">
        {providers.map((p) => (
          <ProviderRow key={p.id} provider={p} />
        ))}
        {!loading && !error && providers.length === 0 && (
          <div className="py-8 text-center text-row text-text-muted">
            No providers yet. Add one above to get started.
          </div>
        )}
      </div>
    </div>
  );
}
