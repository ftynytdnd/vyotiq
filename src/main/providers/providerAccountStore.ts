/**
 * In-memory provider account snapshot cache (main process only).
 */

import type {
  ProviderAccountSnapshot,
  ProviderAccountSnapshotMap
} from '@shared/types/providerAccount.js';
import { isBalanceLow } from '@shared/providers/lowBalanceThreshold.js';

const cache = new Map<string, ProviderAccountSnapshot>();
/** Peak / top-up reference balance per provider for percent low-balance warnings. */
const referenceBalanceByProvider = new Map<string, number>();

function applyReferenceBalance(snapshot: ProviderAccountSnapshot): ProviderAccountSnapshot {
  const prevRef = referenceBalanceByProvider.get(snapshot.providerId);
  let ref = snapshot.referenceBalanceUsd ?? prevRef;

  const amount = snapshot.balanceUsd ?? snapshot.balanceNative;
  if (amount !== undefined) {
    ref = ref === undefined ? amount : Math.max(ref, amount);
  }
  if (ref !== undefined) {
    referenceBalanceByProvider.set(snapshot.providerId, ref);
    snapshot = { ...snapshot, referenceBalanceUsd: ref };
  }

  if (amount !== undefined) {
    snapshot = {
      ...snapshot,
      lowBalance: isBalanceLow(amount, snapshot.referenceBalanceUsd)
    };
  } else if (snapshot.balanceAvailable === false) {
    snapshot = { ...snapshot, lowBalance: true };
  }

  return snapshot;
}

export function setProviderAccountSnapshot(snapshot: ProviderAccountSnapshot): void {
  cache.set(snapshot.providerId, applyReferenceBalance(snapshot));
}

export function getProviderAccountSnapshot(
  providerId: string
): ProviderAccountSnapshot | undefined {
  return cache.get(providerId);
}

export function getAllProviderAccountSnapshots(): ProviderAccountSnapshotMap {
  const out: Record<string, ProviderAccountSnapshot> = {};
  for (const [id, snap] of cache) out[id] = snap;
  return out;
}

export function evictProviderAccountSnapshot(providerId: string): void {
  cache.delete(providerId);
  referenceBalanceByProvider.delete(providerId);
}
