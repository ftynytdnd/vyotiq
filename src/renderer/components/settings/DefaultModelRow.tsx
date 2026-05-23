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
import { formatTokenCount } from '../../lib/formatTokens.js';

export function DefaultModelRow({ embedded = false }: { embedded?: boolean }) {
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
  // Guard: only keep `currentValue` selected if the underlying provider /
  // model is still enabled + discovered. Otherwise the dropdown shows its
  // placeholder instead of a stale id.
  const resolvedValue =
    currentValue && items.some((i) => i.value === currentValue) ? currentValue : null;

  return (
    <div
      className={
        embedded
          ? 'flex flex-col gap-2 border-b border-border-subtle/30 py-3'
          : 'flex items-start justify-between gap-4 border-b border-border-subtle/30 py-3'
      }
    >
      <div className="min-w-0 flex-1">
        <div className="text-body text-text-primary">Default model</div>
        <div className="mt-0.5 text-row leading-relaxed text-text-muted">
          The model used by Agent V. Picking a new default applies it to the active
          composer immediately and persists across restarts. Populated from every
          enabled provider&apos;s discovered models.
        </div>
      </div>
      <Dropdown<string>
        items={items}
        value={resolvedValue}
        placeholder={items.length === 0 ? 'No models available' : 'Select model…'}
        disabled={items.length === 0}
        className={embedded ? 'w-full' : undefined}
        onChange={(composed) => {
          const idx = composed.indexOf('::');
          if (idx === -1) return;
          const providerId = composed.slice(0, idx);
          const modelId = composed.slice(idx + 2);
          void setDefaultModel({ providerId, modelId });
        }}
      />
    </div>
  );
}
