/**
 * Percent-based low-balance threshold with USD fallback.
 */

import {
  PROVIDER_LOW_BALANCE_PERCENT,
  PROVIDER_LOW_BALANCE_USD
} from '../constants.js';

export function computeLowBalanceThreshold(referenceBalanceUsd: number | undefined): number {
  if (referenceBalanceUsd !== undefined && referenceBalanceUsd > 0) {
    return Math.max(PROVIDER_LOW_BALANCE_USD, referenceBalanceUsd * PROVIDER_LOW_BALANCE_PERCENT);
  }
  return PROVIDER_LOW_BALANCE_USD;
}

export function isBalanceLow(
  balanceUsd: number | undefined,
  referenceBalanceUsd: number | undefined
): boolean {
  if (balanceUsd === undefined) return false;
  return balanceUsd < computeLowBalanceThreshold(referenceBalanceUsd);
}
