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
import { useSettingsStore } from '../../store/useSettingsStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { ShellCaption, ShellRow, ShellRowSplit, ShellSection, ShellStack } from '../ui/ShellSection.js';
import { cn } from '../../lib/cn.js';

function modelLabel(providerId?: string, modelId?: string): string {
  if (!providerId || !modelId) return '—';
  return `${providerId} / ${modelId}`;
}

export function UsagePanel() {
  useProviderAccountPollSource('settings-providers', true);

  const activeWorkspaceId = useWorkspaceStore((s) => s.activeId);
  const workspaces = useWorkspaceStore((s) => s.list);
  const conversations = useConversationsStore((s) => s.list);
  const providers = useProviderStore((s) => s.providers);
  const accounts = useProviderAccountStore((s) => s.snapshots);
  const workspaceSpend = useSettingsStore((s) => s.settings.ui?.workspaceSpendUsd ?? {});

  const activeWorkspaceSpend = activeWorkspaceId
    ? workspaceSpend[activeWorkspaceId]
    : undefined;
  const activeWorkspaceName =
    workspaces.find((w) => w.id === activeWorkspaceId)?.label ?? 'Active workspace';

  const conversationRows = useMemo(() => {
    return [...conversations]
      .filter((c) => !c.archived)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 50);
  }, [conversations]);

  const providerRows = useMemo(() => {
    return providers
      .filter((p) => p.enabled)
      .map((p) => ({
        id: p.id,
        name: p.name,
        accountLine: formatProviderAccountLine(accounts[p.id])
      }));
  }, [providers, accounts]);

  return (
    <ShellStack>
      <ShellSection title="Usage">
        <ShellCaption className="text-text-faint">
          Costs are estimates based on token usage and discovered per-model rates. Provider-billed
          amounts may differ.
        </ShellCaption>
      </ShellSection>

      <ShellSection title="Active workspace">
        <ShellRow>
          <ShellRowSplit
            main={<span className="text-row text-text-primary">{activeWorkspaceName}</span>}
            control={
              <span className="font-mono text-meta tabular-nums text-text-secondary">
                {formatWorkspaceSpend(activeWorkspaceSpend) ??
                  (activeWorkspaceSpend && activeWorkspaceSpend > 0
                    ? formatComposerCostUsd(activeWorkspaceSpend)
                    : '—')}
              </span>
            }
          />
        </ShellRow>
      </ShellSection>

      <ShellSection title="Conversations">
        <ShellCaption className="mb-2 text-text-faint">Per-chat cumulative Vyotiq estimates.</ShellCaption>
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
              return (
                <div
                  key={c.id}
                  className="flex min-w-0 items-baseline justify-between gap-3 py-1.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-row text-text-primary">{c.title}</div>
                    <div className="truncate text-meta text-text-faint">
                      {modelLabel(c.lastProviderId, c.lastModelId)}
                      {peak ? ` · peak ${peak}` : ''}
                    </div>
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
        <ShellCaption className="mb-2 text-text-faint">Live account snapshots from provider APIs.</ShellCaption>
        {providerRows.length === 0 ? (
          <ShellCaption className="text-text-faint">No enabled providers.</ShellCaption>
        ) : (
          <div className="flex flex-col divide-y divide-border-subtle/30">
            {providerRows.map((row) => (
              <div
                key={row.id}
                className="flex min-w-0 items-baseline justify-between gap-3 py-1.5"
              >
                <span className="min-w-0 truncate text-row text-text-primary">{row.name}</span>
                <span className="shrink-0 font-mono text-meta tabular-nums text-text-secondary">
                  {row.accountLine ?? '—'}
                </span>
              </div>
            ))}
          </div>
        )}
      </ShellSection>
    </ShellStack>
  );
}
