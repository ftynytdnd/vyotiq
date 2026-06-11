/**
 * Background poller for model discovery when billing UI is active.
 * Shares poll-source registry with the account poller.
 */

import { IPC, PROVIDER_ACCOUNT_POLL_ACTIVE_MS, PROVIDER_ACCOUNT_POLL_IDLE_MS } from '@shared/constants.js';
import type { ProviderModelsUpdate } from '@shared/types/provider.js';
import { modelsFingerprint } from '@shared/providers/modelsFingerprint.js';
import { listProviders, getProviderWithKey } from './providerStore.js';
import { discoverModels } from './modelDiscovery.js';
import { hasActivePollSources } from './providerPollSources.js';
import { logger } from '../logging/logger.js';
import { safeWebContentsSend } from '../window/safeWebContentsSend.js';

const log = logger.child('providers/discovery-poller');

let timer: ReturnType<typeof setInterval> | null = null;
let tickInFlight = false;
let currentIntervalMs = PROVIDER_ACCOUNT_POLL_IDLE_MS;
let discoveryPollerEverStarted = false;
const lastFingerprintByProvider = new Map<string, string>();

function effectiveIntervalMs(): number {
  return hasActivePollSources() ? PROVIDER_ACCOUNT_POLL_ACTIVE_MS : PROVIDER_ACCOUNT_POLL_IDLE_MS;
}

function broadcastModelsUpdate(update: ProviderModelsUpdate): void {
  safeWebContentsSend(IPC.PROVIDERS_MODELS_UPDATED, update);
}

function rescheduleTimer(): void {
  const next = effectiveIntervalMs();
  if (next === currentIntervalMs && timer) return;
  currentIntervalMs = next;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (!hasActivePollSources()) return;
  timer = setInterval(() => {
    void pollOnce();
  }, currentIntervalMs);
  timer.unref();
  log.debug('provider discovery poll interval updated', { intervalMs: currentIntervalMs });
}

async function pollOnce(): Promise<void> {
  if (!hasActivePollSources()) return;
  if (tickInFlight) return;
  tickInFlight = true;

  try {
    const providers = await listProviders();
    for (const p of providers.filter((x) => x.enabled)) {
      const withKey = await getProviderWithKey(p.id);
      if (!withKey?.apiKey?.trim()) continue;
      try {
        const prior = p.models ?? [];
        const priorFp = modelsFingerprint(prior);
        const models = await discoverModels(p.id, false);
        const nextFp = modelsFingerprint(models);
        if (nextFp === priorFp) continue;
        const cachedFp = lastFingerprintByProvider.get(p.id);
        if (cachedFp === nextFp) continue;
        lastFingerprintByProvider.set(p.id, nextFp);
        const refreshed = (await listProviders()).find((x) => x.id === p.id);
        const update: ProviderModelsUpdate = {
          providerId: p.id,
          models,
          lastDiscoveredAt: refreshed?.lastDiscoveredAt ?? Date.now()
        };
        broadcastModelsUpdate(update);
      } catch (err) {
        log.debug('discovery poll failed', { providerId: p.id, err });
      }
    }
  } finally {
    tickInFlight = false;
  }
}

export function notifyProviderPollSourcesChanged(): void {
  if (!hasActivePollSources()) {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    return;
  }
  if (!timer) {
    currentIntervalMs = effectiveIntervalMs();
    void pollOnce();
    timer = setInterval(() => {
      void pollOnce();
    }, currentIntervalMs);
    timer.unref();
    if (discoveryPollerEverStarted) {
      log.debug('provider discovery poller resumed', { intervalMs: currentIntervalMs });
    } else {
      discoveryPollerEverStarted = true;
      log.info('provider discovery poller started', { intervalMs: currentIntervalMs });
    }
    return;
  }
  rescheduleTimer();
}

export function startProviderDiscoveryPoller(): void {
  notifyProviderPollSourcesChanged();
}

export function stopProviderDiscoveryPoller(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  tickInFlight = false;
  lastFingerprintByProvider.clear();
  discoveryPollerEverStarted = false;
}

/** Test-only reset. */
export function __test_resetProviderDiscoveryPoller(): void {
  lastFingerprintByProvider.clear();
  discoveryPollerEverStarted = false;
}
