/**
 * models.dev catalog — community-maintained model metadata fallback.
 * https://models.dev/api.json (2026)
 */

import { MODEL_DISCOVERY_TIMEOUT_MS } from '@shared/constants.js';
import { modelsDevProviderId } from '@shared/providers/providerHostname.js';
import type { ModelPricing } from '@shared/providers/modelPricing.js';
import { mergeModelPricing } from '@shared/providers/modelPricing.js';
import type { ModelInfo, ModelThinkingCapabilities, ProviderWithKey, ThinkingEffort } from '@shared/types/provider.js';
import { readPlainJson, writePlainJson } from '../secrets/safeStore.js';
import { logger } from '../logging/logger.js';

const log = logger.child('providers/models-dev');

const MODELS_DEV_URL = 'https://models.dev/api.json';
const CACHE_FILE = 'vyotiq/models-dev-catalog.json';
const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;

type ModelsDevLimit = {
  context?: number;
  input?: number;
  output?: number;
};

type ModelsDevCost = {
  input?: number;
  output?: number;
  cache_read?: number;
  cache_write?: number;
  reasoning?: number;
};

type ModelsDevReasoningOption = {
  type?: string;
  values?: string[];
};

type ModelsDevModelRow = {
  id?: string;
  limit?: ModelsDevLimit;
  cost?: ModelsDevCost;
  reasoning?: boolean;
  tool_call?: boolean;
  reasoning_options?: ModelsDevReasoningOption[];
};

type ModelsDevProviderRow = {
  id?: string;
  models?: Record<string, ModelsDevModelRow>;
};

type ModelsDevApiRoot = Record<string, ModelsDevProviderRow>;

type CatalogEntry = {
  context?: number;
  pricing?: ModelPricing;
  thinking?: ModelThinkingCapabilities;
  supportedParameters?: string[];
  providerId: string;
};

type CatalogCacheFile = {
  fetchedAt: number;
  byKey: Record<string, CatalogEntry>;
};

let memoryCache: { fetchedAt: number; byKey: Map<string, CatalogEntry> } | null = null;
let loadInFlight: Promise<Map<string, CatalogEntry>> | null = null;

function positiveTokenCount(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const n = Math.floor(value);
  return n > 0 ? n : undefined;
}

function pricingNeedsFallback(pricing: ModelPricing | undefined): boolean {
  if (!pricing) return true;
  return (
    pricing.inputPerMillion === undefined ||
    pricing.inputPerMillion <= 0 ||
    pricing.outputPerMillion === undefined ||
    pricing.outputPerMillion <= 0 ||
    pricing.cachedInputPerMillion === undefined ||
    pricing.cachedInputPerMillion <= 0
  );
}

function pricingFromCost(cost: ModelsDevCost | undefined): ModelPricing | undefined {
  if (!cost) return undefined;
  const inputPerMillion = cost.input;
  const outputPerMillion = cost.output;
  if (typeof inputPerMillion !== 'number' || typeof outputPerMillion !== 'number') return undefined;
  const pricing: ModelPricing = { inputPerMillion, outputPerMillion };
  if (typeof cost.cache_read === 'number') pricing.cachedInputPerMillion = cost.cache_read;
  if (typeof cost.cache_write === 'number') pricing.cacheWriteInputPerMillion = cost.cache_write;
  if (typeof cost.reasoning === 'number') pricing.reasoningPerMillion = cost.reasoning;
  return pricing;
}

function catalogKeysForModelId(modelId: string): string[] {
  const trimmed = modelId.trim().toLowerCase();
  const keys = new Set<string>([trimmed]);
  const slash = trimmed.lastIndexOf('/');
  if (slash >= 0) keys.add(trimmed.slice(slash + 1));
  return [...keys];
}

function thinkingFromModelsDevRow(row: ModelsDevModelRow): ModelThinkingCapabilities | undefined {
  if (row.reasoning !== true) return undefined;
  const effortValues = new Set<ThinkingEffort>();
  for (const option of row.reasoning_options ?? []) {
    if (option.type !== 'effort') continue;
    for (const value of option.values ?? []) {
      if (
        value === 'minimal' ||
        value === 'low' ||
        value === 'medium' ||
        value === 'high' ||
        value === 'xhigh'
      ) {
        effortValues.add(value);
      }
    }
  }
  const efforts =
    effortValues.size > 0
      ? (['off', ...effortValues] as ThinkingEffort[])
      : (['off', 'low', 'medium', 'high'] as ThinkingEffort[]);
  return {
    supported: true,
    wireStyle: 'openai-reasoning',
    efforts
  };
}

function supportedParametersFromModelsDevRow(row: ModelsDevModelRow): string[] | undefined {
  const params: string[] = [];
  if (row.tool_call) params.push('tools', 'tool_choice');
  if (row.reasoning) params.push('reasoning', 'reasoning_effort');
  return params.length > 0 ? params : undefined;
}

function indexCatalog(root: ModelsDevApiRoot): Map<string, CatalogEntry> {
  const byKey = new Map<string, CatalogEntry>();
  for (const [providerId, providerRow] of Object.entries(root)) {
    const models = providerRow?.models;
    if (!models || typeof models !== 'object') continue;
    for (const [modelId, row] of Object.entries(models)) {
      const context = positiveTokenCount(row.limit?.context ?? row.limit?.input);
      const pricing = pricingFromCost(row.cost);
      const thinking = thinkingFromModelsDevRow(row);
      const supportedParameters = supportedParametersFromModelsDevRow(row);
      if (
        context === undefined &&
        !pricing &&
        !thinking &&
        !supportedParameters
      ) {
        continue;
      }
      const entry: CatalogEntry = {
        providerId,
        context,
        pricing,
        thinking,
        supportedParameters
      };
      for (const key of catalogKeysForModelId(modelId)) {
        if (!byKey.has(key)) byKey.set(key, entry);
      }
      if (row.id) {
        for (const key of catalogKeysForModelId(row.id)) {
          if (!byKey.has(key)) byKey.set(key, entry);
        }
      }
    }
  }
  return byKey;
}

async function fetchCatalog(): Promise<Map<string, CatalogEntry>> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), MODEL_DISCOVERY_TIMEOUT_MS);
  try {
    const res = await fetch(MODELS_DEV_URL, {
      headers: { Accept: 'application/json' },
      signal: ctrl.signal
    });
    if (!res.ok) {
      throw new Error(`models.dev fetch failed: ${res.status}`);
    }
    const json = (await res.json()) as ModelsDevApiRoot;
    const byKey = indexCatalog(json);
    log.info('models.dev catalog loaded', { entries: byKey.size });
    return byKey;
  } finally {
    clearTimeout(timer);
  }
}

async function readDiskCache(): Promise<{ fetchedAt: number; byKey: Map<string, CatalogEntry> } | null> {
  const raw = await readPlainJson<CatalogCacheFile>(CACHE_FILE);
  if (!raw?.fetchedAt || !raw.byKey) return null;
  const byKey = new Map<string, CatalogEntry>(Object.entries(raw.byKey));
  return { fetchedAt: raw.fetchedAt, byKey };
}

async function writeDiskCache(fetchedAt: number, byKey: Map<string, CatalogEntry>): Promise<void> {
  const payload: CatalogCacheFile = {
    fetchedAt,
    byKey: Object.fromEntries(byKey)
  };
  await writePlainJson(CACHE_FILE, payload);
}

async function loadCatalog(force = false): Promise<Map<string, CatalogEntry>> {
  if (!force && memoryCache && Date.now() - memoryCache.fetchedAt < CATALOG_TTL_MS) {
    return memoryCache.byKey;
  }

  if (!force) {
    const disk = await readDiskCache();
    if (disk && Date.now() - disk.fetchedAt < CATALOG_TTL_MS) {
      memoryCache = disk;
      return disk.byKey;
    }
  }

  if (loadInFlight) return loadInFlight;

  loadInFlight = (async () => {
    try {
      const byKey = await fetchCatalog();
      const fetchedAt = Date.now();
      memoryCache = { fetchedAt, byKey };
      await writeDiskCache(fetchedAt, byKey).catch((err) => {
        log.warn('models.dev cache write failed', { err });
      });
      return byKey;
    } catch (err) {
      log.warn('models.dev fetch failed; using stale cache if available', { err });
      const disk = await readDiskCache();
      if (disk?.byKey.size) return disk.byKey;
      return new Map();
    } finally {
      loadInFlight = null;
    }
  })();

  return loadInFlight;
}

function lookupEntry(
  catalog: Map<string, CatalogEntry>,
  modelId: string,
  preferProvider?: string
): CatalogEntry | undefined {
  const keys = catalogKeysForModelId(modelId);
  if (preferProvider) {
    for (const key of keys) {
      const hit = catalog.get(key);
      if (hit?.providerId === preferProvider) return hit;
    }
  }
  for (const key of keys) {
    const hit = catalog.get(key);
    if (hit) return hit;
  }
  return undefined;
}

/** Apply models.dev context + pricing to models still missing metadata. */
export async function enrichModelsFromModelsDev(
  provider: ProviderWithKey,
  models: ModelInfo[]
): Promise<ModelInfo[]> {
  const needsEnrichment = models.some(
    (m) =>
      m.contextWindow === undefined ||
      m.pricing === undefined ||
      pricingNeedsFallback(m.pricing) ||
      !m.thinking?.supported ||
      !m.supportedParameters?.length
  );
  if (!needsEnrichment) return models;

  const catalog = await loadCatalog();
  if (catalog.size === 0) return models;

  const preferProvider = modelsDevProviderId(provider.baseUrl);
  let enriched = 0;

  const next = models.map((model) => {
    const hit = lookupEntry(catalog, model.id, preferProvider);
    if (!hit) return model;

    let changed = false;
    let contextWindow = model.contextWindow;
    let pricing = model.pricing;
    let thinking = model.thinking;
    let supportedParameters = model.supportedParameters;

    if (contextWindow === undefined && hit.context !== undefined) {
      contextWindow = hit.context;
      changed = true;
    }
    if (hit.pricing) {
      const merged = mergeModelPricing(pricing, hit.pricing);
      if (merged !== pricing) {
        pricing = merged;
        changed = true;
      }
    }
    if (!thinking?.supported && hit.thinking?.supported) {
      thinking = hit.thinking;
      changed = true;
    }
    if (!supportedParameters?.length && hit.supportedParameters?.length) {
      supportedParameters = hit.supportedParameters;
      changed = true;
    }

    if (!changed) return model;
    enriched += 1;
    return { ...model, contextWindow, pricing, thinking, supportedParameters };
  });

  if (enriched > 0) {
    log.debug('models.dev enrichment applied', { providerId: provider.id, enriched });
  }

  return next;
}

const HOURLY_REFRESH_MS = 60 * 60 * 1000;

/** Refresh models.dev catalog at most once per hour during active UI polling. */
export async function refreshModelsDevCatalogIfStale(): Promise<void> {
  const fetchedAt = memoryCache?.fetchedAt;
  if (fetchedAt !== undefined && Date.now() - fetchedAt < HOURLY_REFRESH_MS) return;
  await loadCatalog(true);
}
