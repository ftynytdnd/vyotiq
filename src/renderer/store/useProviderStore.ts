import { create } from 'zustand';
import type {
  ProviderConfig,
  ModelInfo,
  AddProviderInput,
  ProviderAttribution
} from '@shared/types/provider.js';
import { vyotiq } from '../lib/ipc.js';

interface ProviderStore {
  providers: ProviderConfig[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  add: (input: AddProviderInput) => Promise<ProviderConfig>;
  update: (
    id: string,
    patch: Partial<AddProviderInput> & {
      enabled?: boolean;
      /** OpenRouter app-attribution overrides; see ProviderConfig.attribution. */
      attribution?: ProviderAttribution;
    }
  ) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** Force-refresh `/v1/models` (used by the explicit Refresh button). */
  discover: (id: string) => Promise<ModelInfo[]>;
  /** Cache-respecting discovery (used at app boot). */
  discoverCached: (id: string) => Promise<ModelInfo[]>;
  test: (id: string) => Promise<{ ok: boolean; message: string }>;
  /**
   * Pin a custom context-window size for a specific model on a provider,
   * or clear the override by passing `value: null`. The pinned value
   * wins over whatever `/v1/models` reported. Used when the upstream
   * provider doesn't surface `context_length`.
   */
  setContextOverride: (
    providerId: string,
    modelId: string,
    value: number | null
  ) => Promise<void>;
}

export const useProviderStore = create<ProviderStore>((set, get) => ({
  providers: [],
  loading: false,
  error: null,

  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const providers = await vyotiq.providers.list();
      set({ providers, loading: false });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) });
    }
  },

  add: async (input) => {
    const created = await vyotiq.providers.add(input);
    set({ providers: [...get().providers, created] });
    return created;
  },

  update: async (id, patch) => {
    const updated = await vyotiq.providers.update(id, patch);
    set({
      providers: get().providers.map((p) => (p.id === id ? updated : p))
    });
  },

  remove: async (id) => {
    await vyotiq.providers.remove(id);
    set({ providers: get().providers.filter((p) => p.id !== id) });
  },

  discover: async (id) => {
    const models = await vyotiq.providers.discoverModels(id, true);
    set({
      providers: get().providers.map((p) =>
        p.id === id ? { ...p, models, lastDiscoveredAt: Date.now() } : p
      )
    });
    return models;
  },

  discoverCached: async (id) => {
    const models = await vyotiq.providers.discoverModels(id, false);
    set({
      providers: get().providers.map((p) =>
        p.id === id ? { ...p, models, lastDiscoveredAt: Date.now() } : p
      )
    });
    return models;
  },

  test: (id) => vyotiq.providers.test(id),

  setContextOverride: async (providerId, modelId, value) => {
    const updated = await vyotiq.providers.setContextOverride(providerId, modelId, value);
    set({
      providers: get().providers.map((p) => (p.id === providerId ? updated : p))
    });
  }
}));

/**
 * Effective context-window ceiling for a given (providerId, modelId).
 *
 * Re-exported here for backward-compatibility with renderer call sites
 * (composer + model picker) that imported this from `useProviderStore`.
 * The actual implementation lives in `@shared/providers/contextWindow`
 * so the main-process run-loop can apply the same precedence rules
 * when enforcing per-turn token budgets (Audit fix §2.3).
 */
export { selectEffectiveContextWindow } from '@shared/providers/contextWindow.js';
