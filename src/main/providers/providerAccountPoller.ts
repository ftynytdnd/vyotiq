/**
 * Background poller for provider account snapshots.
 * Starts once at IPC registration; stops on app quit.
 * Poll cadence is adaptive: fast while billing UI is active, slow when idle.
 */

import {
  IPC,
  PROVIDER_ACCOUNT_POLL_ACTIVE_MS,
  PROVIDER_ACCOUNT_POLL_IDLE_MS
} from '@shared/constants.js';
import type { ProviderAccountSnapshotMap } from '@shared/types/providerAccount.js';
import { listProviders, getProviderWithKey } from './providerStore.js';
import { fetchProviderAccount } from './fetchProviderAccount.js';
import {
  getAllProviderAccountSnapshots,
  setProviderAccountSnapshot,
  evictProviderAccountSnapshot
} from './providerAccountStore.js';
import {
  clearProviderPollSources,
  hasActivePollSources,
  setProviderPollSource
} from './providerPollSources.js';
import { notifyProviderPollSourcesChanged } from './providerDiscoveryPoller.js';
import { logger } from '../logging/logger.js';
import { safeWebContentsSend } from '../window/safeWebContentsSend.js';

const log = logger.child('providers/account-poller');

let timer: ReturnType<typeof setInterval> | null = null;
let tickInFlight = false;
let abortController: AbortController | null = null;
let currentIntervalMs = PROVIDER_ACCOUNT_POLL_IDLE_MS;
let lastBroadcastJson: string | null = null;

function broadcastSnapshots(map: ProviderAccountSnapshotMap): void {
  const json = JSON.stringify(map);
  if (json === lastBroadcastJson) return;
  lastBroadcastJson = json;
  safeWebContentsSend(IPC.PROVIDERS_ACCOUNT_UPDATED, map);
}

function effectiveIntervalMs(): number {
  return hasActivePollSources()
    ? PROVIDER_ACCOUNT_POLL_ACTIVE_MS
    : PROVIDER_ACCOUNT_POLL_IDLE_MS;
}

function rescheduleTimer(): void {
  const next = effectiveIntervalMs();
  if (next === currentIntervalMs && timer) return;
  currentIntervalMs = next;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  timer = setInterval(() => {
    void pollOnce();
  }, currentIntervalMs);
  timer.unref();
  log.debug('provider account poll interval updated', {
    intervalMs: currentIntervalMs,
    activeSources: hasActivePollSources()
  });
}

async function pollOnce(): Promise<void> {
  if (tickInFlight) return;
  tickInFlight = true;
  abortController?.abort();
  abortController = new AbortController();
  const signal = abortController.signal;

  try {
    const providers = await listProviders();
    const enabledIds = new Set(providers.filter((p) => p.enabled).map((p) => p.id));

    for (const p of providers) {
      if (!p.enabled) {
        evictProviderAccountSnapshot(p.id);
      }
    }

    for (const p of providers.filter((x) => x.enabled)) {
      if (signal.aborted) break;
      const withKey = await getProviderWithKey(p.id);
      if (!withKey?.apiKey?.trim() && !withKey?.billingApiKey?.trim()) continue;
      try {
        const snap = await fetchProviderAccount(withKey, signal);
        setProviderAccountSnapshot(snap);
        if (snap.status === 'error') {
          log.warn('account poll returned error status', {
            providerId: p.id,
            hostKind: snap.hostKind,
            message: snap.message
          });
        }
      } catch (err) {
        log.warn('account fetch threw', { providerId: p.id, err });
      }
    }

    const all = getAllProviderAccountSnapshots();
    for (const id of Object.keys(all)) {
      if (!enabledIds.has(id)) {
        evictProviderAccountSnapshot(id);
      }
    }

    broadcastSnapshots(getAllProviderAccountSnapshots());
  } finally {
    tickInFlight = false;
  }
}

export function setProviderAccountPollSource(source: string, active: boolean): void {
  setProviderPollSource(source, active);
  rescheduleTimer();
  notifyProviderPollSourcesChanged();
}

export function startProviderAccountPoller(): void {
  if (timer) return;
  currentIntervalMs = effectiveIntervalMs();
  void pollOnce();
  timer = setInterval(() => {
    void pollOnce();
  }, currentIntervalMs);
  timer.unref();
  log.info('provider account poller started', { intervalMs: currentIntervalMs });
}

export function stopProviderAccountPoller(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  abortController?.abort();
  abortController = null;
  tickInFlight = false;
  lastBroadcastJson = null;
  clearProviderPollSources();
}

/** Force a single refresh (IPC manual refresh). */
export async function refreshProviderAccountsNow(): Promise<ProviderAccountSnapshotMap> {
  lastBroadcastJson = null;
  await pollOnce();
  return getAllProviderAccountSnapshots();
}

/** Test-only: reset poll source tracking. */
export function __test_resetProviderAccountPollSources(): void {
  clearProviderPollSources();
  rescheduleTimer();
}
