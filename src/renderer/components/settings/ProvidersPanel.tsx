import { useEffect, useMemo, useState } from 'react';
import { useProviderStore } from '../../store/useProviderStore.js';
import { ProviderRow } from './ProviderRow.js';
import { AddProviderForm } from './AddProviderForm.js';
import { DefaultModelRow } from './DefaultModelRow.js';
import { LoadingHint } from '../ui/LoadingHint.js';
import { Button } from '../ui/Button.js';
import { Notice } from '../ui/Notice.js';
import { ShellCaption, ShellRow, ShellSection } from '../ui/ShellSection.js';
import { isLocalProvider } from '@shared/providers/isLocalProvider.js';
import { cn } from '../../lib/cn.js';

function ProviderBucketBlock({
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
  const selected = providers.find((p) => p.id === selectedId) ?? providers[0] ?? null;

  return (
    <div className="vx-settings-provider-block">
      <h4 className="vx-settings-subhead">{title}</h4>
      <nav aria-label={title} className="vx-settings-provider-list scrollbar-stealth">
        {providers.map((p) => (
          <button
            key={p.id}
            type="button"
            data-active={selectedId === p.id ? 'true' : 'false'}
            onClick={() => onSelect(p.id)}
            className="vx-left-subnav-item app-no-drag"
          >
            {p.name}
          </button>
        ))}
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
  );
}

export function ProvidersPanel() {
  const providers = useProviderStore((s) => s.providers);
  const loading = useProviderStore((s) => s.loading);
  const error = useProviderStore((s) => s.error);
  const refresh = useProviderStore((s) => s.refresh);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addFormOpen, setAddFormOpen] = useState(false);

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

  const localSelected =
    selectedId && localProviders.some((p) => p.id === selectedId)
      ? selectedId
      : localProviders[0]?.id ?? null;
  const cloudSelected =
    selectedId && remoteProviders.some((p) => p.id === selectedId)
      ? selectedId
      : remoteProviders[0]?.id ?? null;

  return (
    <ShellSection title="Models & providers">
      <DefaultModelRow />

      <ShellRow className="pt-0">
        <ShellCaption>
          OpenAI-compatible endpoints; models via <span className="font-mono">GET /v1/models</span>.
          Keys use the OS keychain.
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
        <div className={cn('flex flex-col gap-4')}>
          <ProviderBucketBlock
            title={`Local${localProviders.length > 0 ? ` (${localProviders.length})` : ''}`}
            providers={localProviders}
            selectedId={localSelected}
            onSelect={setSelectedId}
          />
          <ProviderBucketBlock
            title={`Cloud${remoteProviders.length > 0 ? ` (${remoteProviders.length})` : ''}`}
            providers={remoteProviders}
            selectedId={cloudSelected}
            onSelect={setSelectedId}
          />
        </div>
      )}
    </ShellSection>
  );
}
