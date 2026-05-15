/**
 * Provider store. Persists the list of configured providers (including their
 * encrypted API keys) via safeStorage. Provides CRUD + decrypted lookup for
 * the chat client (which is the ONLY caller allowed to see plaintext keys).
 */

import { randomUUID } from 'node:crypto';
import type {
  ProviderConfig,
  ProviderDialect,
  ProviderWithKey,
  AddProviderInput
} from '@shared/types/provider.js';
import { PROVIDERS_FILE } from '@shared/constants.js';
import { normalizeBaseUrl as normalizeBaseUrlShared } from '@shared/providers/normalizeBaseUrl.js';
import { readEncryptedJson, writeEncryptedJson } from '../secrets/safeStore.js';

interface PersistedProvider extends ProviderConfig {
  apiKey: string;
}

let cache: PersistedProvider[] | null = null;

async function load(): Promise<PersistedProvider[]> {
  if (cache) return cache;
  const raw = (await readEncryptedJson<PersistedProvider[]>(PROVIDERS_FILE)) ?? [];
  // One-time migration: re-run `normalizeBaseUrl` on every persisted
  // record so any provider added before the dialect-aware strip
  // existed self-heals on next launch. Without this, a user who saved
  // `https://ollama.com/api` in an earlier build keeps hitting
  // `https://ollama.com/api/v1/models` (or `/api/api/tags`) after
  // upgrade until they delete and re-add. Persists back to disk only
  // if at least one URL actually changed, so this is a no-op for
  // already-clean stores.
  //
  // The normalizer is now dialect-aware: under `'openai'` it strips
  // only `/v1` (so OpenRouter's required `/api` segment is preserved),
  // under `'ollama-native'` it strips only `/api`. Legacy records with
  // no `dialect` field are treated as `'openai'` — same fallback the
  // hot path uses.
  let mutated = false;
  const list = raw.map((p) => {
    const fixed = normalizeBaseUrlShared(p.baseUrl, p.dialect ?? 'openai');
    if (fixed !== p.baseUrl) {
      mutated = true;
      return { ...p, baseUrl: fixed };
    }
    return p;
  });
  cache = list;
  if (mutated) {
    // Migration write: cache is already the authoritative load result,
    // so a write failure here just defers the migration to the next
    // boot — the in-memory shape is still correct.
    await writeEncryptedJson(PROVIDERS_FILE, cache);
  }
  return cache;
}

/**
 * Persist a candidate provider list WITHOUT mutating `cache` first.
 * Every mutator routes through this helper so a `writeEncryptedJson`
 * failure (disk full, OneDrive lock, permission flap) leaves the
 * in-memory cache identical to its pre-call state — callers commit to
 * `cache` only after this resolves successfully. Mirrors the same
 * persist-then-commit pattern used by `workspaceState.persistCandidate`
 * and `settings/blob.updateBlob`'s rollback. Without this discipline,
 * a transient write error during `removeProvider` would leave the
 * provider gone from the in-memory cache (so `getProviderWithKey`
 * returns null and chat fails) while the encrypted file still has it
 * — inconsistent until app restart.
 */
async function persistCandidate(list: PersistedProvider[]): Promise<void> {
  await writeEncryptedJson(PROVIDERS_FILE, list);
}

/** Strips the API key from a provider record before exposing to the renderer. */
function redact(p: PersistedProvider): ProviderConfig {
  const { apiKey: _apiKey, ...safe } = p;
  void _apiKey;
  return safe;
}

export async function listProviders(): Promise<ProviderConfig[]> {
  const list = await load();
  return list.map(redact);
}

/** Internal — returns the full record including the API key. */
export async function getProviderWithKey(id: string): Promise<ProviderWithKey | null> {
  const list = await load();
  const found = list.find((p) => p.id === id);
  return found ? { ...found } : null;
}

export async function addProvider(input: AddProviderInput): Promise<ProviderConfig> {
  const list = await load();
  // Persist the renderer-supplied dialect as-is; the IPC-layer caller
  // (providers.ipc.ts) may run auto-detect before calling this and will
  // then follow up with `updateProvider({ dialect })` if the probe
  // disagreed with the hint. Default `'openai'` matches pre-existing
  // provider semantics so the change is backward-compatible.
  const dialect: ProviderDialect = input.dialect ?? 'openai';
  const baseUrl = normalizeBaseUrlShared(input.baseUrl, dialect);
  const next: PersistedProvider = {
    id: randomUUID(),
    name: input.name.trim() || 'Untitled Provider',
    baseUrl,
    dialect,
    apiKey: input.apiKey,
    enabled: true,
    notes: input.notes,
    models: [],
    lastDiscoveredAt: undefined,
    ...(input.attribution ? { attribution: input.attribution } : {})
  };
  // Persist-then-commit: build the candidate list, write it, and only
  // assign to `cache` after the disk write succeeds. See
  // `persistCandidate` for the full rationale.
  const candidate = [...list, next];
  await persistCandidate(candidate);
  cache = candidate;
  return redact(next);
}

export async function updateProvider(
  id: string,
  patch: Partial<AddProviderInput> & {
    enabled?: boolean;
    dialect?: ProviderDialect;
    models?: ProviderConfig['models'];
    lastDiscoveredAt?: number;
    contextOverrides?: ProviderConfig['contextOverrides'];
    attribution?: ProviderConfig['attribution'];
  }
): Promise<ProviderConfig> {
  const list = await load();
  const idx = list.findIndex((p) => p.id === id);
  if (idx === -1) throw new Error(`Provider not found: ${id}`);
  const current = list[idx]!;
  // Resolve the effective dialect for this update FIRST: normalization
  // depends on it, and the patch may swap dialect and baseUrl in the
  // same call. If only one of the two changed, normalize against the
  // post-patch dialect so the strip rule matches what the chat client
  // will actually append next.
  const nextDialect: ProviderDialect = patch.dialect ?? current.dialect ?? 'openai';
  const next: PersistedProvider = {
    ...current,
    name: patch.name?.trim() || current.name,
    baseUrl: patch.baseUrl
      ? normalizeBaseUrlShared(patch.baseUrl, nextDialect)
      : current.baseUrl,
    dialect: nextDialect,
    apiKey: patch.apiKey ?? current.apiKey,
    notes: patch.notes ?? current.notes,
    enabled: patch.enabled ?? current.enabled,
    models: patch.models ?? current.models,
    lastDiscoveredAt: patch.lastDiscoveredAt ?? current.lastDiscoveredAt,
    contextOverrides: patch.contextOverrides ?? current.contextOverrides,
    // `attribution` is intentionally a full-replace patch (not a deep
    // merge): callers either send the new shape verbatim or omit the
    // field to preserve the existing one. Passing an explicit object
    // with `referer: ''` is how the user clears that one header — see
    // `attributionHeaders.buildAttributionHeaders` for the
    // empty-string ⇒ suppress contract.
    attribution: patch.attribution ?? current.attribution
  };
  // Persist-then-commit: see `persistCandidate`.
  const candidate = list.map((p, i) => (i === idx ? next : p));
  await persistCandidate(candidate);
  cache = candidate;
  return redact(next);
}

/**
 * Pin (or clear) a user-supplied context-window override for a single
 * model on a provider. `value: null` removes the entry; any non-finite
 * or <= 0 number is treated as a clear. The override wins over whatever
 * `/v1/models` reported and is what the renderer uses to render the
 * usage gauge's ceiling.
 */
export async function setContextOverride(
  providerId: string,
  modelId: string,
  value: number | null
): Promise<ProviderConfig> {
  const list = await load();
  const idx = list.findIndex((p) => p.id === providerId);
  if (idx === -1) throw new Error(`Provider not found: ${providerId}`);
  const current = list[idx]!;
  const existing = current.contextOverrides ?? {};
  const next: PersistedProvider = { ...current };
  if (value === null || !Number.isFinite(value) || value <= 0) {
    const { [modelId]: _removed, ...rest } = existing;
    void _removed;
    if (Object.keys(rest).length === 0) {
      delete next.contextOverrides;
    } else {
      next.contextOverrides = rest;
    }
  } else {
    next.contextOverrides = { ...existing, [modelId]: Math.floor(value) };
  }
  // Persist-then-commit: see `persistCandidate`.
  const candidate = list.map((p, i) => (i === idx ? next : p));
  await persistCandidate(candidate);
  cache = candidate;
  return redact(next);
}

export async function removeProvider(id: string): Promise<void> {
  const list = await load();
  const candidate = list.filter((p) => p.id !== id);
  // Persist-then-commit. The previous shape mutated `cache = next`
  // BEFORE awaiting `save()` — a write failure left the in-memory
  // cache missing the provider while the encrypted file still had it,
  // so `getProviderWithKey` returned null and chat sends started
  // failing until the next app restart. Now `cache` is only updated
  // after the disk write succeeds.
  await persistCandidate(candidate);
  cache = candidate;
}

// Base-URL normalization moved to `@shared/providers/normalizeBaseUrl`
// so the renderer validator, the dialect-detection probe, the chat
// streamers, and this persisted-store hardener all agree on a single
// dialect-aware rule. The shared helper strips ONLY the suffix the
// post-persist runtime would re-append (`/v1` for `'openai'`, `/api`
// for `'ollama-native'`), which is the difference between OpenRouter
// (whose canonical base is `https://openrouter.ai/api`) working on
// first try vs. 404'ing every request because `/api` was eagerly
// stripped under the old dialect-blind regex.
