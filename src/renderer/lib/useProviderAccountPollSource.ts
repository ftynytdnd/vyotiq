/**
 * Signals main-process provider account poll cadence while billing UI is active.
 */

import { useEffect } from 'react';
import { vyotiq } from './ipc.js';

export type ProviderAccountPollSource =
  | 'model-picker'
  | 'composer'
  | 'settings-providers'
  | 'agent-run';

export function setProviderAccountPollSource(
  source: ProviderAccountPollSource,
  active: boolean
): void {
  void vyotiq.providers.setAccountPollSource(source, active);
}

export function useProviderAccountPollSource(
  source: ProviderAccountPollSource,
  active: boolean
): void {
  useEffect(() => {
    setProviderAccountPollSource(source, active);
    return () => setProviderAccountPollSource(source, false);
  }, [source, active]);
}
