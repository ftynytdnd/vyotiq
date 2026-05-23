import { useEffect } from 'react';
import { useProviderStore } from '../../store/useProviderStore.js';
import { ProviderRow } from './ProviderRow.js';
import { AddProviderForm } from './AddProviderForm.js';
import { DefaultModelRow } from './DefaultModelRow.js';
import { Spinner } from '../ui/Spinner.js';
import { Button } from '../ui/Button.js';
import { Notice } from '../ui/Notice.js';

export function ProvidersPanel({ embedded = false }: { embedded?: boolean }) {
  const providers = useProviderStore((s) => s.providers);
  const loading = useProviderStore((s) => s.loading);
  const error = useProviderStore((s) => s.error);
  const refresh = useProviderStore((s) => s.refresh);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="flex flex-col gap-4">
      {/* Default model lives at the top of the Providers panel — see
          `DefaultModelRow` for the rationale (it is a provider-routing
          preference, not a permission). Renders empty-state placeholder
          when no providers are configured yet. */}
      <DefaultModelRow embedded={embedded} />
      <div className="text-row leading-relaxed text-text-muted">
        Add an OpenAI-compatible provider. Vyotiq calls{' '}
        <span className="font-mono text-text-secondary">GET /v1/models</span> to discover
        available models. Keys are encrypted via your OS keychain (Electron safeStorage).
      </div>

      {error && (
        <Notice
          tone="danger"
          title="Failed to load providers."
          actions={
            <Button size="sm" variant="secondary" onClick={() => void refresh()}>
              Retry
            </Button>
          }
        >
          <span className="break-words text-text-muted">{error}</span>
        </Notice>
      )}

      <AddProviderForm />

      {loading && (
        <div className="flex items-center gap-2 text-row text-text-muted">
          <Spinner /> Loading providers…
        </div>
      )}

      <div className="flex flex-col divide-y divide-border-subtle/30">
        {providers.map((p) => (
          <ProviderRow key={p.id} provider={p} embedded={embedded} />
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
