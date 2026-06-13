/**
 * Provider account summary — full inline breakdown for Settings → Providers.
 */

import type { ProviderConfig } from '@shared/types/provider.js';
import {
  formatProviderAccountDetailRows,
  isProviderAccountLow,
  managementKeyDocsUrl,
  providerNeedsManagementKey
} from '../../lib/formatProviderAccount.js';
import { useProviderAccountStore } from '../../store/useProviderAccountStore.js';
import { ShellCaption } from '../ui/ShellSection.js';
import { cn } from '../../lib/cn.js';

interface ProviderAccountSummaryProps {
  provider: ProviderConfig;
}

export function ProviderAccountSummary({ provider }: ProviderAccountSummaryProps) {
  const snapshot = useProviderAccountStore((s) => s.snapshotFor(provider.id));
  const rows = formatProviderAccountDetailRows(snapshot);
  const low = isProviderAccountLow(snapshot);
  const accountError =
    snapshot?.status === 'error' && snapshot.message?.trim().length
      ? snapshot.message.trim()
      : null;
  const needsMgmtKey = providerNeedsManagementKey(snapshot);
  const mgmtDocs = managementKeyDocsUrl(snapshot?.hostKind);

  if (rows.length === 0 && !snapshot?.dashboardUrl && !needsMgmtKey && !accountError) return null;

  return (
    <div
      className={cn(
        'mt-2 flex flex-col gap-1 rounded-md border border-border-subtle/40 px-2 py-1.5',
        (low || accountError) && 'border-warning/40'
      )}
      aria-label="Provider account"
    >
      {accountError ? (
        <ShellCaption className="text-warning">{accountError}</ShellCaption>
      ) : null}
      {low ? (
        <ShellCaption className="text-warning">Low balance — top up or switch providers</ShellCaption>
      ) : null}
      {rows.map((row) => (
        <div key={row.label} className="flex min-w-0 items-baseline justify-between gap-3">
          <span className="shrink-0 text-meta text-text-faint">{row.label}</span>
          <span
            className={cn(
              'min-w-0 truncate text-right font-mono text-meta tabular-nums',
              low && row.label === 'Balance' ? 'text-warning' : 'text-text-secondary'
            )}
          >
            {row.value}
          </span>
        </div>
      ))}
      {needsMgmtKey ? (
        <ShellCaption className="text-text-secondary">
          Add a Management / billing key below for full account credits.
          {mgmtDocs ? (
            <>
              {' '}
              <a
                href={mgmtDocs}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline-offset-2 hover:underline"
              >
                Provider docs
              </a>
            </>
          ) : null}
        </ShellCaption>
      ) : null}
      {snapshot?.dashboardUrl ? (
        <a
          href={snapshot.dashboardUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="vx-btn-text mt-0.5 self-start text-meta text-accent"
        >
          Open billing dashboard
        </a>
      ) : null}
    </div>
  );
}
