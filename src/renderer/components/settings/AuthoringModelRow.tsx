/**
 * AuthoringModelRow — optional frontier model for harness/skill authoring.
 * Day-to-day runs use DefaultModelRow. Supports build-with-frontier /
 * execute-with-local strategy without architecture changes.
 */
import { useMemo } from 'react';
import { useProviderStore } from '../../store/useProviderStore.js';
import {
  EMPTY_AUTO_MODEL_BY_WORKSPACE,
  useSettingsStore
} from '../../store/useSettingsStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { persistSettingsPatch } from '../../lib/persistSettingsPatch.js';
import { Dropdown, type DropdownItem } from '../ui/Dropdown.js';
import { Button } from '../ui/Button.js';
import { ShellCaption, ShellRow, ShellRowSplit } from '../ui/ShellSection.js';
import { effectiveContextWindow } from '@shared/providers/contextWindow.js';
import { formatTokenCount } from '../../lib/formatTokens.js';

export function AuthoringModelRow() {
  const providers = useProviderStore((s) => s.providers);
  const authoring = useSettingsStore((s) => s.settings.authoringModel);
  const setAuthoringModel = useSettingsStore((s) => s.setAuthoringModel);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeId);
  const autoModelByWorkspace = useSettingsStore(
    (s) => s.settings.ui?.autoModelByWorkspace ?? EMPTY_AUTO_MODEL_BY_WORKSPACE
  );
  const autoModelEnabled = Boolean(
    activeWorkspaceId && autoModelByWorkspace[activeWorkspaceId]
  );

  const items: DropdownItem<string>[] = useMemo(() => {
    const out: DropdownItem<string>[] = [];
    for (const p of providers) {
      if (!p.enabled) continue;
      const models = p.models ?? [];
      for (const m of models) {
        out.push({
          value: `${p.id}::${m.id}`,
          label: m.id,
          ...(() => {
            const ctx = effectiveContextWindow(m, p.contextOverrides);
            return typeof ctx === 'number'
              ? { description: `${formatTokenCount(ctx)} context` }
              : {};
          })(),
          group: p.name
        });
      }
    }
    return out;
  }, [providers]);

  const currentValue = authoring ? `${authoring.providerId}::${authoring.modelId}` : null;
  const resolvedValue =
    currentValue && items.some((i) => i.value === currentValue) ? currentValue : null;

  return (
    <ShellRow>
      <ShellRowSplit
        main={
          <ShellCaption>
            Optional frontier model for editing harness sections and authoring skills.
            Opening Harness or Skills switches the composer to this model when set.
          </ShellCaption>
        }
        control={
          <div className="flex min-w-0 w-full items-center gap-2">
            <Dropdown<string>
              items={items}
              value={resolvedValue}
              placeholder={items.length === 0 ? 'No models available' : 'Same as default (none)…'}
              disabled={items.length === 0}
              className="min-w-0 w-full max-w-none flex-1"
              onChange={(composed) => {
                const idx = composed.indexOf('::');
                if (idx === -1) return;
                const providerId = composed.slice(0, idx);
                const modelId = composed.slice(idx + 2);
                void setAuthoringModel({ providerId, modelId });
              }}
            />
            {authoring ? (
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0"
                onClick={() => void setAuthoringModel(null)}
              >
                Clear
              </Button>
            ) : null}
          </div>
        }
      />
      {authoring && activeWorkspaceId ? (
        <label className="mt-2 flex cursor-pointer items-center gap-2 text-meta text-text-muted">
          <input
            type="checkbox"
            className="accent-accent"
            checked={autoModelEnabled}
            onChange={(e) => {
              void persistSettingsPatch({
                ui: {
                  autoModelByWorkspace: {
                    ...autoModelByWorkspace,
                    [activeWorkspaceId]: e.target.checked
                  }
                }
              });
            }}
          />
          Prefer authoring model in composer for this workspace
        </label>
      ) : null}
    </ShellRow>
  );
}
