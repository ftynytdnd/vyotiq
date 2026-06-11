/**
 * Renderer store for live provider account snapshots (main-process poller).
 */

import { create } from 'zustand';
import type {
  ProviderAccountSnapshot,
  ProviderAccountSnapshotMap
} from '@shared/types/providerAccount.js';
import { vyotiq } from '../lib/ipc.js';

interface ProviderAccountStore {
  snapshots: ProviderAccountSnapshotMap;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  refresh: () => Promise<void>;
  applyMap: (map: ProviderAccountSnapshotMap) => void;
  snapshotFor: (providerId: string) => ProviderAccountSnapshot | undefined;
}

export const useProviderAccountStore = create<ProviderAccountStore>((set, get) => ({
  snapshots: {},
  hydrated: false,

  hydrate: async () => {
    try {
      const map = await vyotiq.providers.getAccounts();
      set({ snapshots: map, hydrated: true });
    } catch {
      set({ hydrated: true });
    }
  },

  refresh: async () => {
    try {
      const map = await vyotiq.providers.refreshAccounts();
      set({ snapshots: map, hydrated: true });
    } catch {
      /* non-fatal */
    }
  },

  applyMap: (map) => set({ snapshots: map, hydrated: true }),

  snapshotFor: (providerId) => get().snapshots[providerId]
}));
