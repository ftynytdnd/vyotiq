import { useCallback, useEffect, useState } from 'react';
import { resolvePromptCachingSettings } from '@shared/settings/promptCachingSettings.js';
import type { PromptCacheRuntimeStatus } from '@shared/types/promptCache.js';
import { useSettingsStore } from '../../store/useSettingsStore.js';
import { persistSettingsPatch } from '../../lib/persistSettingsPatch.js';
import { useChatStore } from '../../store/useChatStore.js';
import { useConversationsStore } from '../../store/useConversationsStore.js';
import { vyotiq } from '../../lib/ipc.js';
import { formatTokenCountWithUnit } from '../../lib/formatTokens.js';
import { useToastStore } from '../../store/useToastStore.js';
import { ShellCaption, ShellSection } from '../ui/ShellSection.js';
import { SettingsSwitchRow } from './SettingsSwitchRow.js';

function formatGeminiCacheState(status: PromptCacheRuntimeStatus['geminiExplicitCache']): string {
  switch (status.state) {
    case 'disabled':
      return 'Off';
    case 'below_threshold':
      return status.detail ?? 'Static prefix below threshold';
    case 'active':
      return status.detail ? `Active (${status.detail})` : 'Active';
    case 'error':
      return status.detail ? `Error: ${status.detail}` : 'Error';
    default: {
      const _exhaustive: never = status.state;
      return String(_exhaustive);
    }
  }
}

export function PromptCachingPanel() {
  const settings = useSettingsStore((s) => s.settings);
  const promptCaching = resolvePromptCachingSettings(settings.ui);
  const orchestratorUsage = useChatStore((s) => s.orchestratorUsage);
  const lastMissReason = useChatStore((s) => s.lastPromptCacheMissReason);
  const conversationId = useChatStore((s) => s.conversationId);
  const conversationMeta = useConversationsStore((s) =>
    conversationId ? (s.list.find((m) => m.id === conversationId) ?? null) : null
  );

  const [runtimeStatus, setRuntimeStatus] = useState<PromptCacheRuntimeStatus | null>(null);

  const refreshRuntime = useCallback(() => {
    void vyotiq.promptCache.getStatus().then(setRuntimeStatus).catch((err) => {
      setRuntimeStatus(null);
      const msg = err instanceof Error ? err.message : String(err);
      useToastStore.getState().show(`Could not load prompt cache status: ${msg}`, 'danger');
    });
  }, []);

  useEffect(() => {
    refreshRuntime();
  }, [refreshRuntime, promptCaching.geminiExplicitCache]);

  const apply = (patch: Partial<NonNullable<typeof settings.ui>['promptCaching']>) => {
    void persistSettingsPatch({
      ui: { promptCaching: { ...settings.ui?.promptCaching, ...patch } }
    }).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        useToastStore.getState().show(`Could not save prompt caching settings: ${msg}`, 'danger');
      });
  };

  const latest = orchestratorUsage?.latest;
  const cached = latest?.cachedPromptTokens ?? 0;
  const cacheWrite = latest?.cacheCreationTokens ?? 0;
  const prompt = latest?.promptTokens ?? 0;
  const cachePct =
    prompt > 0 && cached > 0 ? Math.round((cached / prompt) * 100) : null;

  const copySessionStats = () => {
    const lines = [
      conversationMeta?.lastProviderId && conversationMeta?.lastModelId
        ? `Model: ${conversationMeta.lastProviderId} / ${conversationMeta.lastModelId}`
        : null,
      prompt > 0 ? `Prompt: ${formatTokenCountWithUnit(prompt)}` : null,
      cached > 0 ? `Cache read: ${formatTokenCountWithUnit(cached)}` : null,
      cacheWrite > 0 ? `Cache write: ${formatTokenCountWithUnit(cacheWrite)}` : null,
      lastMissReason ? `Cache miss reason: ${lastMissReason}` : null,
      runtimeStatus
        ? `Gemini explicit: ${formatGeminiCacheState(runtimeStatus.geminiExplicitCache)}`
        : null
    ].filter((l): l is string => l !== null);
    void navigator.clipboard.writeText(lines.join('\n')).then(
      () => useToastStore.getState().show('Copied cache stats', 'success'),
      () => useToastStore.getState().show('Could not copy to clipboard', 'danger')
    );
  };

  return (
    <ShellSection title="Prompt caching" className="mt-4">
      <ShellCaption>
        Reduces cost and latency when static prefixes repeat across turns. Static harness and
        workspace sit at the top; volatile runtime data stays at the tail. OpenAI routes with{' '}
        <code className="font-mono text-meta">prompt_cache_key</code> (~15 req/min per prefix).
      </ShellCaption>
      <SettingsSwitchRow
        label="Anthropic cache diagnostics"
        description="Surfaces cache miss reasons in logs and the active session summary (beta header)."
        value={promptCaching.anthropicCacheDiagnostics}
        onChange={(v) => apply({ anthropicCacheDiagnostics: v })}
      />
      <label className="mt-2 flex max-w-md flex-col gap-1">
        <span className="text-meta font-medium text-text-secondary">Anthropic cache TTL</span>
        <span className="text-meta text-text-faint">
          1h keeps long agent sessions warm (2× write surcharge vs 5-minute ephemeral).
        </span>
        <select
          className="vx-input w-full font-mono text-row"
          value={promptCaching.anthropicCacheTtl}
          onChange={(e) =>
            apply({ anthropicCacheTtl: e.target.value === '5m' ? '5m' : '1h' })
          }
          aria-label="Anthropic cache TTL"
        >
          <option value="1h">1 hour (default)</option>
          <option value="5m">5 minutes</option>
        </select>
      </label>
      <SettingsSwitchRow
        label="Gemini explicit cache"
        description="Opt in to named cachedContents when the static prefix is large enough."
        value={promptCaching.geminiExplicitCache}
        onChange={(v) => apply({ geminiExplicitCache: v })}
      />
      <SettingsSwitchRow
        label="OpenAI extended cache retention"
        description="Send 24h prompt_cache_retention for GPT-5, o3, and o4 on the direct OpenAI host."
        value={promptCaching.openaiExtendedCacheRetention}
        onChange={(v) => apply({ openaiExtendedCacheRetention: v })}
      />
      <div className="mt-3 space-y-1 border-t border-border-subtle pt-3">
        <p className="text-meta font-medium text-text-secondary">Active session</p>
        {latest && prompt > 0 ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-meta text-text-faint tabular-nums">
            {conversationMeta?.lastProviderId ? (
              <>
                <dt>Provider</dt>
                <dd className="truncate text-text-secondary">
                  {conversationMeta.lastProviderId}
                  {conversationMeta.lastModelId ? ` · ${conversationMeta.lastModelId}` : ''}
                </dd>
              </>
            ) : null}
            <dt>Last prompt</dt>
            <dd>{formatTokenCountWithUnit(prompt)}</dd>
            {cached > 0 ? (
              <>
                <dt>Cache read</dt>
                <dd>
                  {formatTokenCountWithUnit(cached)}
                  {cachePct !== null ? ` (${cachePct}%)` : ''}
                </dd>
              </>
            ) : null}
            {cacheWrite > 0 ? (
              <>
                <dt>Cache write</dt>
                <dd>{formatTokenCountWithUnit(cacheWrite)}</dd>
              </>
            ) : null}
            {lastMissReason ? (
              <>
                <dt>Miss reason</dt>
                <dd className="text-warning">{lastMissReason}</dd>
              </>
            ) : null}
          </dl>
        ) : (
          <p className="text-meta text-text-faint">No token usage in the current conversation yet.</p>
        )}
        {runtimeStatus ? (
          <p className="font-mono text-meta text-text-faint">
            Gemini explicit: {formatGeminiCacheState(runtimeStatus.geminiExplicitCache)}
          </p>
        ) : null}
        {runtimeStatus?.geminiExplicitCache.state === 'active' ? (
          <p className="text-meta text-warning">
            Gemini explicit cache is active — hourly storage fees are not included in Vyotiq cost
            estimates ($1–$4.50/MTok/hr depending on model).
          </p>
        ) : null}
        <button
          type="button"
          className="mt-2 text-meta text-accent hover:underline"
          onClick={() => void copySessionStats()}
        >
          Copy last turn cache stats
        </button>
      </div>
    </ShellSection>
  );
}
