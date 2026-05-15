/**
 * Thin typed wrapper over `window.vyotiq`. The renderer should always go
 * through this module rather than reaching into `window.vyotiq` directly,
 * so we have a single chokepoint for testing and future swap-out.
 */

import type { VyotiqApi } from '@shared/types/ipc.js';

function api(): VyotiqApi {
  if (typeof window === 'undefined' || !window.vyotiq) {
    throw new Error('Vyotiq IPC bridge is not available. Are we running outside Electron?');
  }
  return window.vyotiq;
}

export const vyotiq: VyotiqApi = new Proxy({} as VyotiqApi, {
  get(_target, prop: string) {
    const real = api() as unknown as Record<string, unknown>;
    return real[prop];
  }
});
