/**
 * Format provider account snapshots for compact UI labels.
 */

import type { ProviderAccountSnapshot } from '@shared/types/providerAccount.js';
import { formatRunCostUsd } from '@shared/providers/estimateRunCost.js';
import { formatClaudeCodeProxyAccountLine } from '@shared/providers/claudeCodeProxy.js';

function currencySymbol(currency: string | undefined): string {
  const c = (currency ?? 'USD').toUpperCase();
  if (c === 'CNY') return '¥';
  if (c === 'EUR') return '€';
  if (c === 'GBP') return '£';
  return '$';
}

function formatNativeAmount(amount: number, currency: string | undefined): string {
  const sym = currencySymbol(currency);
  const c = (currency ?? 'USD').toUpperCase();
  if (c === 'CNY') return `${sym}${amount.toFixed(2)}`;
  return formatRunCostUsd(amount).replace('$', sym);
}

export function formatBalanceAmount(snapshot: ProviderAccountSnapshot | undefined): string | null {
  if (!snapshot) return null;
  if (snapshot.balanceNative !== undefined) {
    return formatNativeAmount(snapshot.balanceNative, snapshot.currency);
  }
  if (snapshot.balanceUsd !== undefined) {
    return formatRunCostUsd(snapshot.balanceUsd);
  }
  return null;
}

function formatResetAt(ms: number): string {
  const delta = ms - Date.now();
  if (delta <= 0) return 'now';
  const min = Math.ceil(delta / 60_000);
  if (min < 60) return `${min}m`;
  const hr = Math.ceil(min / 60);
  return `${hr}h`;
}

function formatRateLimits(snapshot: ProviderAccountSnapshot): string | null {
  const limits = snapshot.limits;
  if (!limits) return null;
  const parts: string[] = [];
  if (limits.requestsRemaining !== undefined && limits.requestsLimit !== undefined) {
    parts.push(`${limits.requestsRemaining}/${limits.requestsLimit} req`);
  }
  if (limits.tokensRemaining !== undefined && limits.tokensLimit !== undefined) {
    parts.push(`${limits.tokensRemaining}/${limits.tokensLimit} tok/min`);
  }
  const resetAt = limits.resetAt ?? snapshot.resetsAt?.[0];
  if (resetAt !== undefined) {
    parts.push(`resets ${formatResetAt(resetAt)}`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

export function providerNeedsManagementKey(
  snapshot: ProviderAccountSnapshot | undefined
): boolean {
  return Boolean(snapshot?.managementKeyRequired);
}

export function managementKeyDocsUrl(hostKind: string | undefined): string | null {
  switch (hostKind) {
    case 'openrouter':
      return 'https://openrouter.ai/docs/guides/overview/auth/management-api-keys';
    case 'xai':
      return 'https://docs.x.ai/developers/management-api-guide';
    default:
      return null;
  }
}

/** One-line account summary for picker footer and settings lists. */
export function formatProviderAccountLine(snapshot: ProviderAccountSnapshot | undefined): string | null {
  if (!snapshot) return null;
  if (snapshot.status === 'local') return 'Local — no billing';
  if (snapshot.hostKind === 'claude-code-proxy') return formatClaudeCodeProxyAccountLine(snapshot);

  const parts: string[] = [];
  if (snapshot.planLabel) parts.push(snapshot.planLabel);
  const bal = formatBalanceAmount(snapshot);
  if (bal) parts.push(`${bal} left`);
  if (snapshot.usage?.daily?.spendUsd !== undefined) {
    parts.push(`${formatRunCostUsd(snapshot.usage.daily.spendUsd)} today`);
  } else if (snapshot.usage?.weekly?.spendUsd !== undefined) {
    parts.push(`${formatRunCostUsd(snapshot.usage.weekly.spendUsd)} this week`);
  }
  const limitsLine = formatRateLimits(snapshot);
  if (limitsLine && !bal) parts.push(limitsLine);
  if (parts.length === 0) {
    if (snapshot.message) return snapshot.message;
    return snapshot.status === 'unavailable' ? 'Balance unavailable' : null;
  }
  return parts.join(' · ');
}

/** Composer chip row — omit healthy claude-code-proxy noise (warnings use ComposerProxyStatusStrip). */
export function formatComposerAccountLine(snapshot: ProviderAccountSnapshot | undefined): string | null {
  if (!snapshot) return null;
  if (snapshot.hostKind === 'claude-code-proxy') return null;
  return formatProviderAccountLine(snapshot);
}

export interface ProviderAccountDetailRow {
  label: string;
  value: string;
}

/** Full account breakdown rows for Settings inline panel. */
export function formatProviderAccountDetailRows(
  snapshot: ProviderAccountSnapshot | undefined
): ProviderAccountDetailRow[] {
  if (!snapshot) return [];
  const rows: ProviderAccountDetailRow[] = [];

  if (snapshot.status === 'local') {
    rows.push({ label: 'Billing', value: 'Local provider — no cloud billing' });
    return rows;
  }

  if (snapshot.hostKind === 'claude-code-proxy') {
    if (snapshot.planLabel) rows.push({ label: 'Bridge', value: snapshot.planLabel });
    if (snapshot.message) rows.push({ label: 'Status', value: snapshot.message });
    if (snapshot.fetchedAt) {
      const ageSec = Math.max(0, Math.round((Date.now() - snapshot.fetchedAt) / 1000));
      rows.push({
        label: 'Updated',
        value: ageSec < 5 ? 'just now' : `${ageSec}s ago`
      });
    }
    return rows;
  }

  if (snapshot.planLabel) rows.push({ label: 'Plan', value: snapshot.planLabel });
  if (snapshot.tierLabel) rows.push({ label: 'Key label', value: snapshot.tierLabel });

  const bal = formatBalanceAmount(snapshot);
  if (bal) rows.push({ label: 'Balance', value: bal });

  if (snapshot.usage?.daily?.spendUsd !== undefined) {
    rows.push({
      label: 'Usage today',
      value: formatRunCostUsd(snapshot.usage.daily.spendUsd)
    });
  }
  if (snapshot.usage?.weekly?.spendUsd !== undefined) {
    rows.push({
      label: 'Usage this week',
      value: formatRunCostUsd(snapshot.usage.weekly.spendUsd)
    });
  }
  if (snapshot.usage?.weekly?.tokens !== undefined) {
    rows.push({
      label: 'Tokens this week',
      value: snapshot.usage.weekly.tokens.toLocaleString()
    });
  }
  if (snapshot.usage?.monthly?.spendUsd !== undefined) {
    rows.push({
      label: 'Usage this month',
      value: formatRunCostUsd(snapshot.usage.monthly.spendUsd)
    });
  }
  if (snapshot.usage?.allTime?.spendUsd !== undefined) {
    rows.push({
      label: snapshot.usage.allTime.label ?? 'All-time usage',
      value: formatRunCostUsd(snapshot.usage.allTime.spendUsd)
    });
  }

  const limitsLine = formatRateLimits(snapshot);
  if (limitsLine) rows.push({ label: 'Rate limits', value: limitsLine });

  if (snapshot.message && !bal) {
    rows.push({ label: 'Note', value: snapshot.message });
  } else if (snapshot.message && snapshot.status === 'unavailable') {
    rows.push({ label: 'Note', value: snapshot.message });
  }

  if (snapshot.fetchedAt) {
    const ageSec = Math.max(0, Math.round((Date.now() - snapshot.fetchedAt) / 1000));
    rows.push({
      label: 'Updated',
      value: ageSec < 5 ? 'just now' : `${ageSec}s ago`
    });
  }

  return rows;
}

export function isProviderAccountLow(snapshot: ProviderAccountSnapshot | undefined): boolean {
  return Boolean(snapshot?.lowBalance);
}
