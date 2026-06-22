/**
 * Gemini explicit context cache for stable system + tool declarations.
 * Opt-in via `VYOTIQ_GEMINI_EXPLICIT_CACHE=1`.
 *
 * @see https://ai.google.dev/gemini-api/docs/caching
 */

import { createHash } from 'node:crypto';
import type { ChatStreamRequest } from '../chatClient.js';
import { stableStringify } from '@shared/json/stableStringify.js';
import { logger } from '../../logging/logger.js';
import {
  getPromptCachingSettings,
  setGeminiExplicitCacheStatus
} from '../../settings/promptCachingRuntime.js';

const log = logger.child('providers/cache/gemini-explicit');

/** Rough static-prefix size before explicit cache is worthwhile (~2k tokens). */
const MIN_STATIC_CHARS = 6_000;

/** Default explicit-cache TTL on the wire. */
const CACHE_TTL = '3600s';

interface CacheEntry {
  name: string;
  expiresAt: number;
}

const store = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<string | undefined>>();

function geminiExplicitCacheEnvFlag(): boolean | undefined {
  const flag = process.env['VYOTIQ_GEMINI_EXPLICIT_CACHE'];
  if (flag === '1' || flag === 'true') return true;
  if (flag === '0' || flag === 'false') return false;
  return undefined;
}

export function isGeminiExplicitCacheEnabled(): boolean {
  const env = geminiExplicitCacheEnvFlag();
  if (env === false) return false;
  if (env === true) return true;
  return getPromptCachingSettings().geminiExplicitCache;
}

/** True when explicit cache should run for a prefix at least `staticSize` chars. */
export function shouldUseGeminiExplicitCache(staticSize: number): boolean {
  const env = geminiExplicitCacheEnvFlag();
  if (env === false) return false;
  if (staticSize < MIN_STATIC_CHARS) return false;
  return env === true || getPromptCachingSettings().geminiExplicitCache;
}

function staticFingerprint(
  providerId: string,
  model: string,
  staticSystem: string,
  workspaceBlock: string | undefined,
  tools: ChatStreamRequest['tools']
): string {
  return createHash('sha256')
    .update(providerId)
    .update('\0')
    .update(model)
    .update('\0')
    .update(
      stableStringify({
        system: staticSystem,
        workspace: workspaceBlock ?? '',
        tools
      })
    )
    .digest('hex');
}

function cacheHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-goog-api-key': apiKey
  };
}

function modelResourceId(model: string): string {
  return model.startsWith('models/') ? model : `models/${model}`;
}

async function createCachedContent(opts: {
  baseUrl: string;
  apiKey: string;
  geminiAuthMode?: 'query' | 'header';
  model: string;
  staticSystem: string;
  workspaceBlock?: string;
  tools: ChatStreamRequest['tools'];
  signal?: AbortSignal;
}): Promise<string | undefined> {
  const tools = opts.tools ?? [];
  const query =
    opts.geminiAuthMode === 'query'
      ? `?key=${encodeURIComponent(opts.apiKey)}`
      : '';
  const url = `${opts.baseUrl}/v1beta/cachedContents${query}`;
  const headers: Record<string, string> =
    opts.geminiAuthMode === 'query' ? { 'Content-Type': 'application/json' } : cacheHeaders(opts.apiKey);

  const instructionParts: Array<{ text: string }> = [{ text: opts.staticSystem }];
  const workspace = opts.workspaceBlock?.trim();
  if (workspace) instructionParts.push({ text: workspace });

  const body: Record<string, unknown> = {
    model: modelResourceId(opts.model),
    systemInstruction: { parts: instructionParts },
    ttl: CACHE_TTL
  };
  if (tools.length > 0) {
    body['tools'] = [
      {
        functionDeclarations: tools.map((t) => ({
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters
        }))
      }
    ];
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: opts.signal
  });
  if (!res.ok) {
    const preview = (await res.text()).slice(0, 300);
    log.debug('gemini explicit cache create failed', {
      status: res.status,
      preview
    });
    return undefined;
  }
  const json = (await res.json()) as { name?: string };
  return typeof json.name === 'string' && json.name.length > 0 ? json.name : undefined;
}

/**
 * Resolve a Gemini `cachedContents/…` resource for the static prefix.
 * Returns undefined when disabled, too small, or creation fails.
 */
export async function resolveGeminiExplicitCacheName(opts: {
  providerId: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  geminiAuthMode?: 'query' | 'header';
  staticSystem: string;
  workspaceBlock?: string;
  tools?: ChatStreamRequest['tools'];
  signal?: AbortSignal;
}): Promise<string | undefined> {
  const tools = opts.tools ?? [];
  const staticSystem = opts.staticSystem.trim();
  const workspace = opts.workspaceBlock?.trim() ?? '';
  const staticSize =
    staticSystem.length + workspace.length + stableStringify(tools).length;

  if (!shouldUseGeminiExplicitCache(staticSize)) {
    if (staticSize < MIN_STATIC_CHARS) {
      setGeminiExplicitCacheStatus({
        state: 'below_threshold',
        detail: `Static prefix ${staticSize} chars (need ${MIN_STATIC_CHARS})`
      });
    } else {
      setGeminiExplicitCacheStatus({ state: 'disabled' });
    }
    return undefined;
  }
  if (!opts.apiKey.trim()) {
    setGeminiExplicitCacheStatus({ state: 'error', detail: 'Missing API key' });
    return undefined;
  }

  const fp = staticFingerprint(
    opts.providerId,
    opts.model,
    staticSystem,
    workspace || undefined,
    tools
  );
  const key = `${opts.providerId}:${opts.model}:${fp}`;
  const now = Date.now();
  const cached = store.get(key);
  if (cached && cached.expiresAt > now) {
    setGeminiExplicitCacheStatus({ state: 'active', detail: cached.name });
    return cached.name;
  }

  const pending = inFlight.get(key);
  if (pending) return pending;

  const work = (async (): Promise<string | undefined> => {
    try {
      const name = await createCachedContent({ ...opts, tools });
      if (name) {
        store.set(key, { name, expiresAt: now + 55 * 60_000 });
        setGeminiExplicitCacheStatus({ state: 'active', detail: name });
        log.info('gemini explicit cache created', { providerId: opts.providerId, model: opts.model });
      } else {
        setGeminiExplicitCacheStatus({ state: 'error', detail: 'Create returned no name' });
      }
      return name;
    } catch (err) {
      log.debug('gemini explicit cache create threw', { err });
      setGeminiExplicitCacheStatus({
        state: 'error',
        detail: err instanceof Error ? err.message : String(err)
      });
      return undefined;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, work);
  return work;
}

/** Evict cached resources for a removed or disabled provider. */
export function evictGeminiExplicitCacheForProvider(providerId: string): void {
  const prefix = `${providerId}:`;
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
  for (const key of inFlight.keys()) {
    if (key.startsWith(prefix)) inFlight.delete(key);
  }
}

/** Test-only reset. */
export function _resetGeminiExplicitCacheForTests(): void {
  store.clear();
  inFlight.clear();
}
