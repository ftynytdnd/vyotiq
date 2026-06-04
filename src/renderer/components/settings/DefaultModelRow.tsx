/**
 * DefaultModelRow — persists the user's preferred default (provider, model)
 * selection via `useSettingsStore.setDefaultModel`. The composer and new
 * conversations fall back to this when the active conversation has no
 * previously-used model recorded. Built with the shared `Dropdown`
 * primitive so grouping + description rendering stay consistent with the
 * rest of the app.
 *
 * Surface placement: rendered at the TOP of the `Providers` settings
 * tab (immediately above the providers list). Conceptually the default
 * model IS a provider-routing preference — pinning it inside
 * Permissions previously made it look like a security setting, which
 * confused users scanning the modal.
 *
 * The dropdown value is a synthetic `providerId::modelId` string because
 * `Dropdown`'s generic is constrained to `string`; we split on the way out.
 */
import { useMemo } from 'react';
import { useProviderStore } from '../../store/useProviderStore.js';
import { useSettingsStore } from '../../store/useSettingsStore.js';
import { Dropdown, type DropdownItem } from '../ui/Dropdown.js';
import { ShellCaption, ShellFieldLabel, ShellRow, ShellRowSplit } from '../ui/ShellSection.js';
import { formatTokenCount } from '../../lib/formatTokens.js';

export function DefaultModelRow({ embedded: _embedded = false }: { embedded?: boolean }) {
  const providers = useProviderStore((s) => s.providers);
  const def = useSettingsStore((s) => s.settings.defaultModel);
  const setDefaultModel = useSettingsStore((s) => s.setDefaultModel);

  const items: DropdownItem<string>[] = useMemo(() => {
    const out: DropdownItem<string>[] = [];
    for (const p of providers) {
      if (!p.enabled) continue;
      const models = p.models ?? [];
      for (const m of models) {
        out.push({
          value: `${p.id}::${m.id}`,
          label: m.id,
          ...(typeof m.contextWindow === 'number'
            ? { description: `${formatTokenCount(m.contextWindow)} context` }
            : {}),
          group: p.name
        });
      }
    }
    return out;
  }, [providers]);

  const currentValue = def ? `${def.providerId}::${def.modelId}` : null;
  const resolvedValue =
    currentValue && items.some((i) => i.value === currentValue) ? currentValue : null;

  return (
    <ShellRow>
      <ShellRowSplit
        main={
          <>
            <ShellFieldLabel>Default model</ShellFieldLabel>
            <ShellCaption>
              Used by Agent V and the composer. Applies immediately and persists across restarts.
            </ShellCaption>
          </>
        }
        control={
          <Dropdown<string>
            items={items}
            value={resolvedValue}
            placeholder={items.length === 0 ? 'No models available' : 'Select model…'}
            disabled={items.length === 0}
            className="min-w-0 w-full max-w-none"
            onChange={(composed) => {
              const idx = composed.indexOf('::');
              if (idx === -1) return;
              const providerId = composed.slice(0, idx);
              const modelId = composed.slice(idx + 2);
              void setDefaultModel({ providerId, modelId });
            }}
          />
        }
      />
    </ShellRow>
  );
}
