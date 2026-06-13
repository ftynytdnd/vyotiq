/**
 * Settings → Agent behavior — inline Tab/ghost completion.
 */

import { useMemo } from 'react';
import {
  resolveInlineCompletionSettings,
  DEFAULT_INLINE_COMPLETION_SETTINGS
} from '@shared/settings/inlineCompletionSettings.js';
import { useSettingsStore } from '../../store/useSettingsStore.js';
import { useProviderStore } from '../../store/useProviderStore.js';
import { useToastStore } from '../../store/useToastStore.js';
import { vyotiq } from '../../lib/ipc.js';
import { ShellCaption, ShellSection } from '../ui/ShellSection.js';
import { SettingsSwitchRow } from './SettingsSwitchRow.js';

export function InlineCompletionPanel() {
  const settings = useSettingsStore((s) => s.settings);
  const refresh = useSettingsStore((s) => s.refresh);
  const providers = useProviderStore((s) => s.providers);
  const inline = resolveInlineCompletionSettings(settings.ui);

  const modelOptions = useMemo(() => {
    const out: Array<{ value: string; label: string }> = [
      { value: '', label: 'Same as chat model' }
    ];
    for (const p of providers) {
      if (!p.enabled) continue;
      for (const m of p.models ?? []) {
        out.push({
          value: `${p.id}\u0000${m.id}`,
          label: `${p.name} / ${m.id}`
        });
      }
    }
    return out;
  }, [providers]);

  const selectedModelValue = inline.model
    ? `${inline.model.providerId}\u0000${inline.model.modelId}`
    : '';

  const apply = (patch: Partial<NonNullable<typeof settings.ui>['inlineCompletion']>) => {
    void vyotiq.settings
      .set({ ui: { inlineCompletion: { ...settings.ui?.inlineCompletion, ...patch } } })
      .then(() => refresh())
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        useToastStore.getState().show(`Could not save inline completion settings: ${msg}`, 'danger');
      });
  };

  return (
    <ShellSection title="Inline completion" className="vx-inline-completion-panel">
      <ShellCaption>
        Tab/ghost suggestions in the editor and composer. Uses a small, fast completion request via
        your configured providers (local or cloud). Defaults to the active chat model when no
        dedicated model is set.
      </ShellCaption>

      <SettingsSwitchRow
        label="Enable inline completion"
        description="Master switch for editor and composer ghost text."
        value={inline.enabled}
        onChange={(enabled) => apply({ enabled })}
      />

      <SettingsSwitchRow
        label="Editor completions"
        description="Fill-in-the-middle ghost text in the workspace editor."
        value={inline.editorEnabled}
        disabled={!inline.enabled}
        onChange={(editorEnabled) => apply({ editorEnabled })}
      />

      <SettingsSwitchRow
        label="Composer completions"
        description="Continue your prompt inline while typing in the composer."
        value={inline.composerEnabled}
        disabled={!inline.enabled}
        onChange={(composerEnabled) => apply({ composerEnabled })}
      />

      <label className="vx-settings-field flex flex-col gap-1.5">
        <span className="text-meta text-text-muted">Completion model</span>
        <select
          className="vx-select"
          value={selectedModelValue}
          disabled={!inline.enabled}
          onChange={(e) => {
            const raw = e.target.value;
            if (!raw) {
              apply({ providerId: undefined, modelId: undefined });
              return;
            }
            const [providerId, modelId] = raw.split('\u0000');
            if (providerId && modelId) apply({ providerId, modelId });
          }}
        >
          {modelOptions.map((opt) => (
            <option key={opt.value || 'default'} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>

      <label className="vx-settings-field flex flex-col gap-1.5">
        <span className="text-meta text-text-muted">Debounce (ms)</span>
        <input
          className="vx-input"
          type="number"
          min={150}
          max={2000}
          step={50}
          value={inline.debounceMs}
          disabled={!inline.enabled}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isFinite(n)) return;
            apply({
              debounceMs: Math.min(
                2000,
                Math.max(150, Math.round(n || DEFAULT_INLINE_COMPLETION_SETTINGS.debounceMs))
              )
            });
          }}
        />
      </label>
    </ShellSection>
  );
}
