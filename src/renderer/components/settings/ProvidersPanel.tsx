import { useEffect, useMemo, useState } from 'react';
import { useProviderStore } from '../../store/useProviderStore.js';
import { ProviderRow } from './ProviderRow.js';
import { AddProviderForm } from './AddProviderForm.js';
import { DefaultModelRow } from './DefaultModelRow.js';
import { LoadingHint } from '../ui/LoadingHint.js';
import { Button } from '../ui/Button.js';
import { Notice } from '../ui/Notice.js';
import { LeftSubnavLayout } from '../ui/LeftSubnav.js';
import { ShellCaption, ShellRow, ShellSection, ShellStack } from '../ui/ShellSection.js';
import { chromeListEmptyClassName } from '../ui/SurfaceShell.js';
import { cn } from '../../lib/cn.js';
import { isLocalProvider } from '@shared/providers/isLocalProvider.js';

export function ProvidersPanel({ embedded = false }: { embedded?: boolean }) {
  const providers = useProviderStore((s) => s.providers);
  const loading = useProviderStore((s) => s.loading);
  const error = useProviderStore((s) => s.error);
  const refresh = useProviderStore((s) => s.refresh);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const localProviders = useMemo(
    () => providers.filter((p) => isLocalProvider(p)),
    [providers]
  );
  const remoteProviders = useMemo(
    () => providers.filter((p) => !isLocalProvider(p)),
    [providers]
  );

  useEffect(() => {
    if (providers.length === 0) {
      setSelectedId(null);
      return;
    }
    if (selectedId && providers.some((p) => p.id === selectedId)) return;
    setSelectedId(providers[0]!.id);
  }, [providers, selectedId]);

  const selected = providers.find((p) => p.id === selectedId) ?? null;

  return (
    <ShellStack>
      <ShellSection title="Defaults">
        <DefaultModelRow embedded={embedded} />
      </ShellSection>

      <ShellSection title="Providers">
        <ShellRow>
          <ShellCaption>
            Add an OpenAI-compatible provider. Vyotiq calls{' '}
            <span className="font-mono text-text-secondary">GET /v1/models</span> to discover
            available models. Keys are encrypted via your OS keychain (Electron safeStorage).
          </ShellCaption>
        </ShellRow>

        {error && (
          <Notice
            tone="danger"
            title="Failed to load providers."
            actions={
              <Button variant="secondary" onClick={() => void refresh()}>
                Retry
              </Button>
            }
          >
            <span className="break-words">{error}</span>
          </Notice>
        )}

        <ShellRow>
          <AddProviderForm />
        </ShellRow>

        {loading && (
          <ShellRow>
            <LoadingHint message="Loading providers…" className="py-2" size={12} />
          </ShellRow>
        )}

        {!loading && !error && providers.length === 0 && (
          <div className={chromeListEmptyClassName}>
            No providers yet. Add one above to get started.
          </div>
        )}

        {providers.length > 0 && (
          <LeftSubnavLayout
            className={cn('min-h-[280px]', embedded && 'min-h-[320px]')}
            contentClassName="scrollbar-stealth min-h-0 overflow-y-auto pr-1"
            nav={
              <nav aria-label="Providers" className="vx-left-subnav scrollbar-stealth">
                {localProviders.length > 0 && (
                  <>
                    <div className="px-2 pb-1 pt-1 text-meta font-medium uppercase tracking-wide text-text-faint">
                      Local
                    </div>
                    {localProviders.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        data-active={selectedId === p.id ? 'true' : 'false'}
                        onClick={() => setSelectedId(p.id)}
                        className="vx-left-subnav-item app-no-drag"
                      >
                        {p.name}
                      </button>
                    ))}
                  </>
                )}
                {remoteProviders.length > 0 && (
                  <>
                    <div className="px-2 pb-1 pt-2 text-meta font-medium uppercase tracking-wide text-text-faint">
                      Cloud
                    </div>
                    {remoteProviders.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        data-active={selectedId === p.id ? 'true' : 'false'}
                        onClick={() => setSelectedId(p.id)}
                        className="vx-left-subnav-item app-no-drag"
                      >
                        {p.name}
                      </button>
                    ))}
                  </>
                )}
              </nav>
            }
          >
            <div id="provider-detail-panel" role="tabpanel" aria-labelledby={selected ? `provider-nav-${selected.id}` : undefined}>
              {selected ? (
                <ProviderRow key={selected.id} provider={selected} embedded={embedded} />
              ) : (
                <div className={chromeListEmptyClassName}>Select a provider.</div>
              )}
            </div>
          </LeftSubnavLayout>
        )}
      </ShellSection>
    </ShellStack>
  );
}
