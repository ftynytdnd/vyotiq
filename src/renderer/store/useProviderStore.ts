import { create } from 'zustand';
import type {
  ProviderConfig,
  ModelInfo,
  AddProviderInput,
  OpenAiTransport,
  ProviderAttribution,
  ThinkingEffort
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
      /** Per-model thinking-effort overrides (shallow-merged store-side). */
      modelThinking?: Record<string, ThinkingEffort | null>;
      /** Per-model context-window overrides in tokens (shallow-merged). */
      contextOverrides?: Record<string, number | null>;
      /** OpenAI-dialect transport selection. */
      openaiTransport?: OpenAiTransport;
    }
  ) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** Force-refresh `/v1/models` (used by the explicit Refresh button). */
  discover: (id: string) => Promise<ModelInfo[]>;
  /** Cache-respecting discovery (used at app boot). */
  discoverCached: (id: string) => Promise<ModelInfo[]>;
  test: (id: string) => Promise<{ ok: boolean; message: string }>;
}

/** Enabled provider ids — stable input for boot-time discover effect deps. */
export function selectEnabledProviderIds(providers: ReadonlyArray<ProviderConfig>): string[] {
  const out: string[] = [];
  for (const p of providers) {
    if (p.enabled) out.push(p.id);
  }
  return out;
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

  test: (id) => vyotiq.providers.test(id)
}));
