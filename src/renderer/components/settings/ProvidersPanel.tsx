import { useEffect, useMemo, useState } from 'react';
import { RefreshCcw } from 'lucide-react';
import { useProviderStore } from '../../store/useProviderStore.js';
import { useProviderAccountStore } from '../../store/useProviderAccountStore.js';
import { useProviderAccountPollSource } from '../../lib/useProviderAccountPollSource.js';
import { ProviderRow } from './ProviderRow.js';
import { AddProviderForm } from './AddProviderForm.js';
import { DefaultModelRow } from './DefaultModelRow.js';
import { LoadingHint } from '../ui/LoadingHint.js';
import { Button } from '../ui/Button.js';
import { Notice } from '../ui/Notice.js';
import { ShellCaption, ShellRow, ShellSection } from '../ui/ShellSection.js';
import { isLocalProvider } from '@shared/providers/isLocalProvider.js';
import { cn } from '../../lib/cn.js';
import { SHELL_ROW_ICON_CLASS, SHELL_ROW_ICON_STROKE } from '../../lib/shellIcons.js';

function ProviderNavSection({
  title,
  providers,
  selectedId,
  onSelect
}: {
  title: string;
  providers: ReturnType<typeof useProviderStore.getState>['providers'];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (providers.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <div className="vx-settings-provider-bucket-label">{title}</div>
      {providers.map((p) => (
        <button
          key={p.id}
          type="button"
          data-active={selectedId === p.id ? 'true' : 'false'}
          onClick={() => onSelect(p.id)}
          className="vx-left-subnav-item app-no-drag"
        >
          <span className="min-w-0 flex-1 truncate text-left">{p.name}</span>
          <span className="shrink-0 font-mono text-meta tabular-nums text-text-faint">
            {p.models?.length ?? 0}
          </span>
        </button>
      ))}
    </div>
  );
}

export function ProvidersPanel() {
  const providers = useProviderStore((s) => s.providers);
  const loading = useProviderStore((s) => s.loading);
  const error = useProviderStore((s) => s.error);
  const refresh = useProviderStore((s) => s.refresh);
  const refreshAccounts = useProviderAccountStore((s) => s.refresh);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addFormOpen, setAddFormOpen] = useState(false);
  const [accountsBusy, setAccountsBusy] = useState(false);

  useProviderAccountPollSource('settings-providers', true);

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
    const first = localProviders[0] ?? remoteProviders[0] ?? providers[0];
    setSelectedId(first?.id ?? null);
  }, [providers, selectedId, localProviders, remoteProviders]);

  const selected = providers.find((p) => p.id === selectedId) ?? null;

  return (
    <ShellSection>
      <DefaultModelRow />

      <ShellRow className="pt-0">
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <ShellCaption>
            OpenAI-compatible endpoints; models via <span className="font-mono">GET /v1/models</span>.
            Keys use the OS keychain.
          </ShellCaption>
          <Button
            variant="ghost"
            disabled={accountsBusy}
            onClick={() => {
              setAccountsBusy(true);
              void refreshAccounts().finally(() => setAccountsBusy(false));
            }}
          >
            <RefreshCcw className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} />
            {accountsBusy ? 'Refreshing accounts…' : 'Refresh accounts'}
          </Button>
        </div>
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

      {!loading && !error && providers.length === 0 && (
        <ShellRow className="py-0">
          <div className="vx-settings-empty w-full">
            <p className="text-row text-text-primary">
              Connect a model provider to start chatting.
            </p>
            <Button variant="primary" onClick={() => setAddFormOpen(true)}>
              Add provider
            </Button>
          </div>
        </ShellRow>
      )}

      {(providers.length > 0 || addFormOpen) && (
        <ShellRow className="py-0">
          {addFormOpen ? (
            <div className="surface-shell vx-settings-add-provider">
              <AddProviderForm
                open
                onOpenChange={setAddFormOpen}
                hideTrigger
                onAdded={() => setAddFormOpen(false)}
              />
            </div>
          ) : (
            <AddProviderForm
              open={false}
              onOpenChange={setAddFormOpen}
              onAdded={() => setAddFormOpen(false)}
            />
          )}
        </ShellRow>
      )}

      {loading && (
        <ShellRow>
          <LoadingHint message="Loading providers…" className="py-2" size={12} />
        </ShellRow>
      )}

      {providers.length > 0 && (
        <ShellRow className={cn('py-0')}>
          <div className="vx-settings-provider-block w-full">
            <div className="vx-settings-provider-master">
              <nav
                aria-label="Providers"
                className="vx-settings-provider-rail scrollbar-stealth"
              >
                <div className="vx-settings-provider-list scrollbar-stealth">
                  <ProviderNavSection
                    title={`Local${localProviders.length > 0 ? ` · ${localProviders.length}` : ''}`}
                    providers={localProviders}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                  />
                  <ProviderNavSection
                    title={`Cloud${remoteProviders.length > 0 ? ` · ${remoteProviders.length}` : ''}`}
                    providers={remoteProviders}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                  />
                </div>
              </nav>
              <div
                role="tabpanel"
                className="surface-shell vx-settings-provider-detail scrollbar-stealth"
              >
                {selected ? (
                  <ProviderRow key={selected.id} provider={selected} />
                ) : (
                  <p className="text-meta text-text-faint">Select a provider.</p>
                )}
              </div>
            </div>
          </div>
        </ShellRow>
      )}
    </ShellSection>
  );
}
