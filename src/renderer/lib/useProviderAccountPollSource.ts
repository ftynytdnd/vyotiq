/**
 * Signals main-process provider account poll cadence while billing UI is active.
 *
 * Registry updates run in a layout effect (never during render) so React hook
 * order stays stable when overlays open/close or error boundaries recover.
 */

import { useLayoutEffect, useRef } from 'react';
import { vyotiq } from './ipc.js';

export type ProviderAccountPollSource =
  | 'model-picker'
  | 'composer'
  | 'settings-providers'
  | 'settings-usage'
  | 'agent-run';

const ALL_SOURCES: readonly ProviderAccountPollSource[] = [
  'model-picker',
  'composer',
  'settings-providers',
  'settings-usage',
  'agent-run'
];

type Registration = { source: ProviderAccountPollSource; active: boolean };

let nextRegistrationId = 0;
const registrations = new Map<number, Registration>();
let lastSyncedSnapshot: string | null = null;

function isSourceActive(source: ProviderAccountPollSource): boolean {
  for (const reg of registrations.values()) {
    if (reg.source === source && reg.active) return true;
  }
  return false;
}

function activeSnapshot(): string {
  return ALL_SOURCES.map((source) => `${source}:${isSourceActive(source) ? 1 : 0}`).join('|');
}

function syncAllPollSourcesToMain(): void {
  for (const source of ALL_SOURCES) {
    void vyotiq.providers.setAccountPollSource(source, isSourceActive(source));
  }
}

function maybeSyncPollSources(): void {
  const snapshot = activeSnapshot();
  if (snapshot === lastSyncedSnapshot) return;
  lastSyncedSnapshot = snapshot;
  syncAllPollSourcesToMain();
}

/** Test-only reset. */
export function __test_resetProviderAccountPollRegistrations(): void {
  registrations.clear();
  nextRegistrationId = 0;
  lastSyncedSnapshot = null;
}

export function useProviderAccountPollSource(
  source: ProviderAccountPollSource,
  active: boolean
): void {
  const idRef = useRef<number | null>(null);
  if (idRef.current === null) {
    idRef.current = nextRegistrationId++;
  }
  const id = idRef.current;
  const activeFlag = Boolean(active);

  useLayoutEffect(() => {
    registrations.set(id, { source, active: activeFlag });
    maybeSyncPollSources();

    return () => {
      registrations.delete(id);
      lastSyncedSnapshot = null;
      maybeSyncPollSources();
    };
  }, [id, source, activeFlag]);
}
