/**
 * Recent billing failures per provider+model — skip immediate re-hit within TTL
 * so a sibling model on the same provider stays usable after one model's 402.
 */

import type { ModelSelection } from '@shared/types/provider.js';

export const BILLING_BLOCK_TTL_MS = 5 * 60 * 1000;

interface BillingBlockEntry {
  at: number;
  message: string;
}

const recentBillingBlock = new Map<string, BillingBlockEntry>();

export function billingBlockKeyForSelection(selection: Pick<ModelSelection, 'providerId' | 'modelId'>): string {
  return `${selection.providerId}\0${selection.modelId}`;
}

export function getRecentBillingBlock(
  selection: Pick<ModelSelection, 'providerId' | 'modelId'>
): BillingBlockEntry | undefined {
  const entry = recentBillingBlock.get(billingBlockKeyForSelection(selection));
  if (!entry) return undefined;
  if (Date.now() - entry.at >= BILLING_BLOCK_TTL_MS) {
    recentBillingBlock.delete(billingBlockKeyForSelection(selection));
    return undefined;
  }
  return entry;
}

export function setRecentBillingBlock(
  selection: Pick<ModelSelection, 'providerId' | 'modelId'>,
  message: string
): void {
  recentBillingBlock.set(billingBlockKeyForSelection(selection), {
    at: Date.now(),
    message
  });
}

/** Test-only: clear billing preflight cache between cases. */
export function __test_resetRecentBillingBlock(): void {
  recentBillingBlock.clear();
}
