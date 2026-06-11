/**
 * Composer hint strip — ask-user reply, cache stats, low-balance warnings.
 */

import { memo } from 'react';
import type { ModelSelection } from '@shared/types/provider.js';
import type { PendingAskUserEvent } from '../../lib/pendingAskUser.js';
import {
  formatProviderAccountLine,
  isProviderAccountLow
} from '../../lib/formatProviderAccount.js';
import { formatTokenCountWithUnit } from '../../lib/formatTokens.js';
import { providerDialectReportsPromptCache } from '@shared/providers/promptCacheMetrics.js';
import { useProviderAccountStore } from '../../store/useProviderAccountStore.js';
import { useProviderStore } from '../../store/useProviderStore.js';
import { useChatStore } from '../../store/useChatStore.js';
import { cn } from '../../lib/cn.js';

interface ComposerStatusStripProps {
  pendingAskUser?: PendingAskUserEvent | null;
  model?: ModelSelection | null;
}

export const ComposerStatusStrip = memo(function ComposerStatusStrip({
  pendingAskUser = null,
  model = null
}: ComposerStatusStripProps) {
  const providers = useProviderStore((s) => s.providers);
  const provider = model ? providers.find((p) => p.id === model.providerId) : undefined;
  const providerDialect = provider?.dialect;
  const providerLabel = provider?.name;
  const reportsPromptCache =
    providerDialect !== undefined && providerDialectReportsPromptCache(providerDialect);
  const account = useProviderAccountStore((s) =>
    model ? s.snapshotFor(model.providerId) : undefined
  );
  const accountLine = formatProviderAccountLine(account);
  const lowBalance = isProviderAccountLow(account);
  const orchestratorUsage = useChatStore((s) => s.orchestratorUsage);
  const isProcessing = useChatStore((s) => s.isProcessing);

  if (pendingAskUser) {
    const title =
      pendingAskUser.payload.title?.trim() || 'Clarifying questions';
    return (
      <span
        className="vx-composer-status-strip min-w-0 flex-1 truncate px-0.5 text-meta text-text-secondary"
        role="status"
        aria-live="polite"
      >
        <span className="font-medium text-accent">Reply needed</span>
        {' — '}
        Answer in {title === 'Clarifying questions' ? 'the card above' : `"${title}"`}, or type below
        and press Send
      </span>
    );
  }

  const latest = orchestratorUsage?.latest;
  const cached = latest?.cachedPromptTokens ?? 0;
  const prompt = latest?.promptTokens ?? 0;
  const multiTurn = (orchestratorUsage?.samples ?? 0) > 1;
  const cacheWarn = reportsPromptCache && multiTurn && cached === 0 && prompt >= 1024;
  const cachePct = prompt > 0 && cached > 0 ? Math.round((cached / prompt) * 100) : null;
  const showCacheLine = (isProcessing || multiTurn) && (cached > 0 || cacheWarn);

  if (showCacheLine) {
    return (
      <span
        className={cn(
          'vx-composer-status-strip min-w-0 flex-1 truncate px-0.5 font-mono text-meta tabular-nums',
          cacheWarn ? 'text-warning' : 'text-text-faint'
        )}
        role="status"
        aria-live="polite"
        title={
          cacheWarn
            ? 'No prompt cache hits on this turn — prefix may have changed'
            : undefined
        }
      >
        {providerLabel ? (
          <>
            <span className="text-text-secondary">{providerLabel}</span>
            {' · '}
          </>
        ) : null}
        {cacheWarn ? (
          <>
            <span className="font-medium text-warning">No cache read</span>
            {' · '}
            {formatTokenCountWithUnit(prompt)} prompt
          </>
        ) : (
          <>
            {formatTokenCountWithUnit(cached)} cached
            {cachePct !== null ? ` · ${cachePct}% of prompt` : ''}
          </>
        )}
      </span>
    );
  }

  if (!accountLine) return null;

  return (
    <span
      className={cn(
        'vx-composer-status-strip min-w-0 flex-1 truncate px-0.5 font-mono text-meta tabular-nums',
        lowBalance ? 'text-warning' : 'text-text-faint'
      )}
      role="status"
      aria-live="polite"
      title={lowBalance ? 'Provider balance is low — top up or switch models' : undefined}
    >
      {lowBalance ? (
        <span className="font-medium text-warning">Low balance</span>
      ) : null}
      {lowBalance ? ' · ' : null}
      {accountLine}
    </span>
  );
});
