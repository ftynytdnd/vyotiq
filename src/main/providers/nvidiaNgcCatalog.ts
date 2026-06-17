/**
 * NVIDIA build.nvidia.com context catalog via the public NGC API.
 * integrate.api.nvidia.com `/v1/models` omits context metadata; model cards do not.
 */

import { MODEL_DISCOVERY_TIMEOUT_MS } from '@shared/constants.js';
import { parseNvidiaContextLength } from '@shared/providers/nvidiaNgcContextParse.js';
import type { ModelInfo } from '@shared/types/provider.js';
import { readPlainJson, writePlainJson } from '../secrets/safeStore.js';
import { logger } from '../logging/logger.js';

const log = logger.child('providers/nvidia-ngc');

const NGC_BASE = 'https://api.ngc.nvidia.com/v2';
const BUILD_ORG = 'qc69jvmznzxy';
const CACHE_FILE = 'nvidia-ngc-context.json';
/** Catalog changes infrequently; refresh daily. */
const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_CONCURRENCY = 6;

type CatalogCacheFile = {
  fetchedAt: number;
  byModelId: Record<string, number>;
};

type NgcListResource = {
  name?: string;
  orgName?: string;
  displayName?: string;
  publisher?: string;
};

type NgcEndpointDetail = {
  artifact?: {
    name?: string;
    displayName?: string;
    publisher?: string;
    description?: string;
  };
};

let memoryCache: { fetchedAt: number; byModelId: Map<string, number> } | null = null;
let loadInFlight: Promise<Map<string, number>> | null = null;

async function fetchJson(url: string): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), MODEL_DISCOVERY_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: ctrl.signal
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} for ${url}: ${body.slice(0, 200)}`);
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function listNgcEndpoints(): Promise<NgcListResource[]> {
  const seen = new Set<string>();
  const all: NgcListResource[] = [];
  for (let page = 0; page < 50; page += 1) {
    const q = encodeURIComponent(
      JSON.stringify({
        query: '*',
        filters: [{ field: 'orgName', value: BUILD_ORG }],
        page,
        pageSize: 200
      })
    );
    const json = (await fetchJson(
      `${NGC_BASE}/search/catalog/resources/ENDPOINT?q=${q}`
    )) as {
      results?: Array<{ resources?: NgcListResource[] }>;
      resultTotal?: number;
    };
    let added = 0;
    for (const group of json.results ?? []) {
      for (const res of group.resources ?? []) {
        if (res.orgName !== BUILD_ORG) continue;
        const key = res.name;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        all.push(res);
        added += 1;
      }
    }
    const total = Number(json.resultTotal ?? 0);
    if (added === 0 || all.length >= total) break;
  }
  return all;
}

async function fetchNgcEndpointDetail(name: string): Promise<NgcEndpointDetail | null> {
  try {
    return (await fetchJson(
      `${NGC_BASE}/endpoints/${encodeURIComponent(BUILD_ORG)}/${encodeURIComponent(name)}`
    )) as NgcEndpointDetail;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/HTTP\s+404/.test(msg)) return null;
    throw err;
  }
}

function apiModelId(detail: NgcEndpointDetail): string | undefined {
  const art = detail.artifact;
  const publisher = art?.publisher?.trim();
  const displayName = art?.displayName?.trim();
  if (!publisher || !displayName) return undefined;
  return `${publisher}/${displayName}`;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await mapper(items[i]!, i);
    }
  }
  const workers = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return out;
}

async function buildCatalogFromNgc(): Promise<Map<string, number>> {
  const endpoints = await listNgcEndpoints();
  const byModelId = new Map<string, number>();
  let contextHits = 0;

  await mapWithConcurrency(endpoints, FETCH_CONCURRENCY, async (ep) => {
    const name = ep.name;
    if (!name) return;
    const detail = await fetchNgcEndpointDetail(name);
    if (!detail) return;
    const modelId = apiModelId(detail);
    const ctx = parseNvidiaContextLength(detail.artifact?.description);
    if (!modelId || ctx === undefined) return;
    byModelId.set(modelId, ctx);
    contextHits += 1;
  });

  log.info('NGC context catalog built', {
    endpoints: endpoints.length,
    withContext: contextHits
  });
  return byModelId;
}

async function readDiskCache(): Promise<CatalogCacheFile | null> {
  try {
    return await readPlainJson<CatalogCacheFile>(CACHE_FILE);
  } catch {
    return null;
  }
}

async function writeDiskCache(byModelId: Map<string, number>): Promise<void> {
  const payload: CatalogCacheFile = {
    fetchedAt: Date.now(),
    byModelId: Object.fromEntries(byModelId)
  };
  await writePlainJson(CACHE_FILE, payload);
}

function mapFromDisk(file: CatalogCacheFile): Map<string, number> {
  return new Map(
    Object.entries(file.byModelId).filter(
      (entry): entry is [string, number] => typeof entry[1] === 'number' && entry[1] > 0
    )
  );
}

function isFresh(fetchedAt: number): boolean {
  return Date.now() - fetchedAt < CATALOG_TTL_MS;
}

/** Load or refresh the NVIDIA NGC context catalog (cached 24h). */
export async function loadNvidiaNgcContextCatalog(force = false): Promise<Map<string, number>> {
  if (!force && memoryCache && isFresh(memoryCache.fetchedAt)) {
    return memoryCache.byModelId;
  }

  if (!force) {
    const disk = await readDiskCache();
    if (disk && isFresh(disk.fetchedAt)) {
      const byModelId = mapFromDisk(disk);
      memoryCache = { fetchedAt: disk.fetchedAt, byModelId };
      return byModelId;
    }
  }

  if (loadInFlight) return loadInFlight;

  loadInFlight = (async () => {
    try {
      const byModelId = await buildCatalogFromNgc();
      const fetchedAt = Date.now();
      memoryCache = { fetchedAt, byModelId };
      await writeDiskCache(byModelId);
      return byModelId;
    } catch (err) {
      log.warn('NGC context catalog fetch failed; using stale cache if present', { err });
      const disk = await readDiskCache();
      if (disk?.byModelId) {
        const byModelId = mapFromDisk(disk);
        memoryCache = { fetchedAt: disk.fetchedAt, byModelId };
        return byModelId;
      }
      return new Map();
    } finally {
      loadInFlight = null;
    }
  })();

  return loadInFlight;
}

/** Apply NGC catalog context windows to discovered NVIDIA Integrate models. */
export async function enrichNvidiaModelsContext(models: ModelInfo[]): Promise<ModelInfo[]> {
  if (!models.some((m) => m.contextWindow === undefined)) return models;
  const catalog = await loadNvidiaNgcContextCatalog();
  if (catalog.size === 0) return models;
  return models.map((model) => {
    if (model.contextWindow !== undefined) return model;
    const ctx = catalog.get(model.id);
    if (ctx === undefined) return model;
    return { ...model, contextWindow: ctx };
  });
}
