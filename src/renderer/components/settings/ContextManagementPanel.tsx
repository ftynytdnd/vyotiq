/**
 * Context management settings — proactive context-window reduction for long
 * agent runs (see `docs/context-management-design.md`). Basic knobs cover the
 * thresholds + summarization fallback; an Advanced group exposes the
 * anti-thrash pacing, an optional dedicated summary model, and the opt-in
 * Anthropic server-side compaction backstop.
 */

import { useState } from 'react';
import { vyotiq } from '../../lib/ipc.js';
import { resolveAgentBehaviorSettings } from '@shared/settings/agentBehaviorSettings.js';
import { useSettingsStore } from '../../store/useSettingsStore.js';
import { useProviderStore } from '../../store/useProviderStore.js';
import { useToastStore } from '../../store/useToastStore.js';
import { ShellCaption, ShellSection } from '../ui/ShellSection.js';
import { SettingsSwitchRow } from './SettingsSwitchRow.js';

type ContextManagementPatch = Partial<
  NonNullable<NonNullable<ReturnType<typeof useSettingsStore.getState>['settings']['ui']>['agentBehavior']>['contextManagement']
>;

export function ContextManagementPanel() {
  const settings = useSettingsStore((s) => s.settings);
  const refresh = useSettingsStore((s) => s.refresh);
  const providers = useProviderStore((s) => s.providers);
  const cm = resolveAgentBehaviorSettings(settings.ui).contextManagement;
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const apply = (patch: ContextManagementPatch) => {
    void vyotiq.settings
      .set({
        ui: {
          agentBehavior: {
            contextManagement: { ...settings.ui?.agentBehavior?.contextManagement, ...patch }
          }
        }
      })
      .then(() => refresh())
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        useToastStore.getState().show(`Could not save context settings: ${msg}`, 'danger');
      });
  };

  const pct = (frac: number) => Math.round(frac * 100);
  const fromPct = (raw: string, fallbackFrac: number): number => {
    const n = Number(raw);
    if (!Number.isFinite(n)) return fallbackFrac;
    return Math.min(1, Math.max(0, n / 100));
  };

  const summaryProvider = cm.summaryModel
    ? providers.find((p) => p.id === cm.summaryModel?.providerId)
    : undefined;
  const summaryModels = summaryProvider?.models ?? [];

  const onSummaryProvider = (providerId: string) => {
    if (providerId.length === 0) {
      // Clear → run model summarizes (resolver maps empty ids to null).
      apply({ summaryModel: { providerId: '', modelId: '' } });
      return;
    }
    const provider = providers.find((p) => p.id === providerId);
    const firstModel = provider?.models?.[0]?.id ?? '';
    apply({ summaryModel: { providerId, modelId: firstModel } });
  };

  const onSummaryModel = (modelId: string) => {
    if (!cm.summaryModel) return;
    apply({ summaryModel: { providerId: cm.summaryModel.providerId, modelId } });
  };

  return (
    <ShellSection title="Context management" className="mt-4">
      <ShellCaption>
        Keep long agent runs sharp by proactively managing the prompt against the model&apos;s
        discovered context window. Older detail is offloaded reversibly first (tool-result and
        tool-input clearing, then on-disk references under .vyotiq/compaction/), and only
        summarized as a last resort (full transcript saved under .vyotiq/context-summaries/).
      </ShellCaption>

      <SettingsSwitchRow
        label="Manage context window"
        description="Proactively reduce the prompt before it degrades model reasoning. Recommended on."
        value={cm.enabled}
        onChange={(v) => apply({ enabled: v })}
      />

      <SettingsSwitchRow
        label="Allow summarization fallback"
        description="When reversible offload can't free enough, summarize older history into a recoverable structured note."
        value={cm.summarizationEnabled}
        onChange={(v) => apply({ summarizationEnabled: v })}
      />

      <label className="mt-3 flex flex-col gap-1 text-meta">
        <span>Reduce at (% of context window)</span>
        <input
          type="number"
          min={40}
          max={95}
          step={1}
          disabled={!cm.enabled}
          className="vx-input w-full max-w-xs font-mono text-row disabled:opacity-50"
          value={pct(cm.triggerFraction)}
          onChange={(e) => apply({ triggerFraction: fromPct(e.target.value, cm.triggerFraction) })}
        />
      </label>

      <label className="mt-3 flex flex-col gap-1 text-meta">
        <span>Warn at (% of context window)</span>
        <input
          type="number"
          min={30}
          max={94}
          step={1}
          disabled={!cm.enabled}
          className="vx-input w-full max-w-xs font-mono text-row disabled:opacity-50"
          value={pct(cm.warnFraction)}
          onChange={(e) => apply({ warnFraction: fromPct(e.target.value, cm.warnFraction) })}
        />
      </label>

      <label className="mt-3 flex flex-col gap-1 text-meta">
        <span>Keep last N tool results verbatim</span>
        <input
          type="number"
          min={0}
          max={20}
          step={1}
          disabled={!cm.enabled}
          className="vx-input w-full max-w-xs font-mono text-row disabled:opacity-50"
          value={cm.keepLastToolResults}
          onChange={(e) => {
            const n = Number(e.target.value);
            apply({ keepLastToolResults: Number.isFinite(n) ? Math.round(n) : 3 });
          }}
        />
      </label>

      <button
        type="button"
        className="mt-4 self-start font-mono text-meta text-text-faint transition-colors hover:text-text-secondary"
        onClick={() => setAdvancedOpen((v) => !v)}
        aria-expanded={advancedOpen}
      >
        {advancedOpen ? '▾' : '▸'} Advanced
      </button>

      {advancedOpen && (
        <div className="mt-2 flex flex-col gap-3 border-l border-border-subtle/40 pl-3">
          <label className="flex flex-col gap-1 text-meta">
            <span>Cooldown between passes (seconds)</span>
            <input
              type="number"
              min={0}
              max={300}
              step={1}
              disabled={!cm.enabled}
              className="vx-input w-full max-w-xs font-mono text-row disabled:opacity-50"
              value={Math.round(cm.cooldownMs / 1000)}
              onChange={(e) => {
                const s = Number(e.target.value);
                apply({ cooldownMs: Number.isFinite(s) ? Math.max(0, Math.round(s * 1000)) : cm.cooldownMs });
              }}
            />
          </label>

          <label className="flex flex-col gap-1 text-meta">
            <span>Minimum tokens freed per pass</span>
            <input
              type="number"
              min={0}
              max={1_000_000}
              step={500}
              disabled={!cm.enabled}
              className="vx-input w-full max-w-xs font-mono text-row disabled:opacity-50"
              value={cm.minSavingsTokens}
              onChange={(e) => {
                const n = Number(e.target.value);
                apply({ minSavingsTokens: Number.isFinite(n) ? Math.max(0, Math.round(n)) : cm.minSavingsTokens });
              }}
            />
          </label>

          <div className="flex flex-col gap-1 text-meta">
            <span>Summarization model</span>
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="vx-input font-mono text-row disabled:opacity-50"
                disabled={!cm.enabled || !cm.summarizationEnabled}
                value={cm.summaryModel?.providerId ?? ''}
                onChange={(e) => onSummaryProvider(e.target.value)}
              >
                <option value="">Run model (default)</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              {cm.summaryModel && (
                <select
                  className="vx-input font-mono text-row disabled:opacity-50"
                  disabled={!cm.enabled || !cm.summarizationEnabled || summaryModels.length === 0}
                  value={cm.summaryModel.modelId}
                  onChange={(e) => onSummaryModel(e.target.value)}
                >
                  {summaryModels.length === 0 && <option value="">(no models discovered)</option>}
                  {summaryModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.id}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <span className="vx-caption text-text-faint">
              Route lossy summarization to a cheaper/faster model. Defaults to the run&apos;s model.
            </span>
          </div>

          <SettingsSwitchRow
            label="Anthropic server-side compaction"
            description="Opt-in backstop for Anthropic models: the API summarizes earlier history server-side (compact_20260112). Host-side reduction stays primary."
            value={cm.serverSideCompaction}
            onChange={(v) => apply({ serverSideCompaction: v })}
          />
        </div>
      )}
    </ShellSection>
  );
}
