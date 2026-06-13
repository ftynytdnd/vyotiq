/**
 * Settings → Usage — workspace, conversation, and provider spend overview.
 */

import { useMemo } from 'react';
import { formatProviderAccountLine } from '../../lib/formatProviderAccount.js';
import { formatTokenCountWithUnit } from '../../lib/formatTokens.js';
import { formatComposerCostUsd } from '@shared/providers/estimateRunCost.js';
import {
  formatConversationSpend,
  formatWorkspaceSpend
} from '../../lib/workspaceSpend.js';
import { useProviderAccountPollSource } from '../../lib/useProviderAccountPollSource.js';
import { useConversationsStore } from '../../store/useConversationsStore.js';
import { useProviderAccountStore } from '../../store/useProviderAccountStore.js';
import { useProviderStore } from '../../store/useProviderStore.js';
import { useSessionStatsStore } from '../../store/useSessionStatsStore.js';
import { useSettingsStore, EMPTY_WORKSPACE_SPEND_USD } from '../../store/useSettingsStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { normalizeWorkspaceSpendEntry } from '@shared/types/usageStats.js';
import { ShellCaption, ShellRow, ShellRowSplit, ShellSection, ShellStack } from '../ui/ShellSection.js';
import { cn } from '../../lib/cn.js';

function modelLabel(providerId?: string, modelId?: string): string {
  if (!providerId || !modelId) return '—';
  return `${providerId} / ${modelId}`;
}

function formatPct(pct: number | undefined): string {
  if (pct === undefined || !Number.isFinite(pct)) return '—';
  return `${pct}%`;
}

function formatUsdOptional(usd: number | undefined): string {
  if (usd === undefined || !Number.isFinite(usd) || usd <= 0) return '—';
  return formatComposerCostUsd(usd);
}

function providerReconcileDelta(
  vyotiqEstimate: number,
  providerMonthlyUsd: number | undefined
): string | null {
  if (providerMonthlyUsd === undefined || !Number.isFinite(providerMonthlyUsd)) return null;
  const delta = providerMonthlyUsd - vyotiqEstimate;
  if (Math.abs(delta) < 0.0001) return '±$0';
  const sign = delta > 0 ? '+' : '−';
  return `${sign}${formatComposerCostUsd(Math.abs(delta))}`;
}

export function UsagePanel() {
  useProviderAccountPollSource('settings-usage', true);

  const activeWorkspaceId = useWorkspaceStore((s) => s.activeId);
  const workspaces = useWorkspaceStore((s) => s.list);
  const conversations = useConversationsStore((s) => s.list);
  const providers = useProviderStore((s) => s.providers);
  const discoveryPollHints = useProviderStore((s) => s.discoveryPollHints);
  const accounts = useProviderAccountStore((s) => s.snapshots);
  const workspaceSpend = useSettingsStore(
    (s) => s.settings.ui?.workspaceSpendUsd ?? EMPTY_WORKSPACE_SPEND_USD
  );
  const sessionStats = useSessionStatsStore((s) => s.stats);

  const activeWorkspaceStats = normalizeWorkspaceSpendEntry(
    activeWorkspaceId ? workspaceSpend[activeWorkspaceId] : undefined
  );
  const activeWorkspaceName =
    workspaces.find((w) => w.id === activeWorkspaceId)?.label ?? 'Active workspace';

  const vyotiqWorkspaceTotal = useMemo(() => {
    return Object.values(workspaceSpend).reduce<number>((sum, entry) => {
      return sum + normalizeWorkspaceSpendEntry(entry).spendUsd;
    }, 0);
  }, [workspaceSpend]);

  const conversationRows = useMemo(() => {
    return [...conversations]
      .filter((c) => !c.archived)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 50);
  }, [conversations]);

  const providerRows = useMemo(() => {
    return providers
      .filter((p) => p.enabled)
      .map((p) => {
        const account = accounts[p.id];
        const monthlyUsd = account?.usage?.monthly?.spendUsd;
        const reconcile = providerReconcileDelta(vyotiqWorkspaceTotal, monthlyUsd);
        return {
          id: p.id,
          name: p.name,
          accountLine: formatProviderAccountLine(account),
          reconcile,
          pollHint: discoveryPollHints[p.id]
        };
      });
  }, [providers, accounts, vyotiqWorkspaceTotal, discoveryPollHints]);

  return (
    <ShellStack>
      <ShellSection title="Usage">
        <ShellCaption className="text-text-faint">
          Costs are Vyotiq estimates from token usage and discovered per-model rates (OpenRouter
          includes 5.5% platform fee). Provider-billed amounts may differ.
        </ShellCaption>
      </ShellSection>

      <ShellSection title="App session">
        <ShellCaption className="mb-2 text-text-faint">
          Ephemeral totals since launch — reset when you quit Vyotiq.
        </ShellCaption>
        <ShellRow>
          <ShellRowSplit
            main={<span className="text-row text-text-primary">This session</span>}
            control={
              <span className="font-mono text-meta tabular-nums text-text-secondary">
                {formatUsdOptional(sessionStats.spendUsd)} · {sessionStats.runCount} runs · cache{' '}
                {formatUsdOptional(sessionStats.cacheSavingsUsd)}
              </span>
            }
          />
        </ShellRow>
      </ShellSection>

      <ShellSection title="Active workspace">
        <ShellRow>
          <ShellRowSplit
            main={<span className="text-row text-text-primary">{activeWorkspaceName}</span>}
            control={
              <span className="font-mono text-meta tabular-nums text-text-secondary">
                {formatWorkspaceSpend(activeWorkspaceStats) ?? '—'}
              </span>
            }
          />
        </ShellRow>
        {activeWorkspaceStats.spendUsd > 0 ? (
          <ShellCaption className="text-text-faint">
            {activeWorkspaceStats.runCount} runs · cache saved{' '}
            {formatUsdOptional(activeWorkspaceStats.cacheSavingsUsd)} ·{' '}
            {formatTokenCountWithUnit(activeWorkspaceStats.cachedTokens)} cached ·{' '}
            {formatTokenCountWithUnit(activeWorkspaceStats.reasoningTokens)} reasoning
          </ShellCaption>
        ) : null}
      </ShellSection>

      <ShellSection title="Conversations">
        <ShellCaption className="mb-2 text-text-faint">
          Per-chat cumulative Vyotiq estimates.
        </ShellCaption>
        {conversationRows.length === 0 ? (
          <ShellCaption className="text-text-faint">No conversations yet.</ShellCaption>
        ) : (
          <div className="flex flex-col divide-y divide-border-subtle/30">
            {conversationRows.map((c) => {
              const spend = formatConversationSpend(c.estimatedSpendUsd);
              const peak =
                typeof c.peakPromptTokens === 'number' && c.peakPromptTokens > 0
                  ? formatTokenCountWithUnit(c.peakPromptTokens)
                  : null;
              const subline = [
                modelLabel(c.lastProviderId, c.lastModelId),
                peak ? `peak ${peak}` : null,
                typeof c.runCount === 'number' && c.runCount > 0 ? `${c.runCount} runs` : null,
                c.cumulativeCacheSavingsUsd && c.cumulativeCacheSavingsUsd > 0
                  ? `cache ${formatComposerCostUsd(c.cumulativeCacheSavingsUsd)}`
                  : null,
                c.cumulativeCachedTokens && c.cumulativeCachedTokens > 0
                  ? `${formatTokenCountWithUnit(c.cumulativeCachedTokens)} cached`
                  : null,
                c.cumulativeReasoningTokens && c.cumulativeReasoningTokens > 0
                  ? `${formatTokenCountWithUnit(c.cumulativeReasoningTokens)} reasoning`
                  : null,
                formatPct(c.lastCacheHitPct) !== '—' ? `last cache ${formatPct(c.lastCacheHitPct)}` : null
              ]
                .filter(Boolean)
                .join(' · ');

              return (
                <div
                  key={c.id}
                  className="flex min-w-0 items-baseline justify-between gap-3 py-1.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-row text-text-primary">{c.title}</div>
                    <div className="truncate text-meta text-text-faint">{subline || '—'}</div>
                  </div>
                  <span
                    className={cn(
                      'shrink-0 font-mono text-meta tabular-nums',
                      spend ? 'text-text-secondary' : 'text-text-faint'
                    )}
                  >
                    {spend ?? '—'}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </ShellSection>

      <ShellSection title="Providers">
        <ShellCaption className="mb-2 text-text-faint">
          Live account snapshots from provider APIs. Provider Δ compares monthly billed usage to
          Vyotiq workspace estimates.
        </ShellCaption>
        {providerRows.length === 0 ? (
          <ShellCaption className="text-text-faint">No enabled providers.</ShellCaption>
        ) : (
          <div className="flex flex-col divide-y divide-border-subtle/30">
            {providerRows.map((row) => (
              <div key={row.id} className="flex min-w-0 flex-col gap-0.5 py-1.5">
                <div className="flex min-w-0 items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-row text-text-primary">{row.name}</span>
                  <span className="shrink-0 font-mono text-meta tabular-nums text-text-secondary">
                    {row.accountLine ?? '—'}
                    {row.reconcile ? ` · Δ ${row.reconcile}` : ''}
                  </span>
                </div>
                {row.pollHint ? (
                  <ShellCaption className="text-warning">{row.pollHint}</ShellCaption>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </ShellSection>
    </ShellStack>
  );
}
