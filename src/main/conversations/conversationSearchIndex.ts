/**
 * Append-only prompt excerpt index for Mod+K message search.
 */

import { promises as fs, existsSync } from 'node:fs';
import { join } from 'node:path';
import { conversationsDir } from '../paths/userDataLayout.js';
import { logger } from '../logging/logger.js';
import { redactSensitiveText } from '@shared/text/redactSecretsInText.js';

const log = logger.child('conversations/search-index');

const INDEX_FILE = 'prompt-search-index.json';
const MAX_ENTRIES = 5_000;
const EXCERPT_MAX = 200;
const SEARCH_RESULT_LIMIT = 20;

export interface PromptSearchIndexEntry {
  conversationId: string;
  eventId: string;
  workspaceId: string;
  excerpt: string;
  ts: number;
}

let indexCache: PromptSearchIndexEntry[] | null = null;
let indexLoadPromise: Promise<PromptSearchIndexEntry[]> | null = null;

function indexPath(): string {
  return join(conversationsDir(), INDEX_FILE);
}

async function loadIndex(): Promise<PromptSearchIndexEntry[]> {
  if (indexCache) return indexCache;
  if (indexLoadPromise) return indexLoadPromise;
  indexLoadPromise = (async () => {
    const path = indexPath();
    if (!existsSync(path)) {
      indexCache = [];
      return indexCache;
    }
    try {
      const raw = await fs.readFile(path, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        indexCache = [];
        return indexCache;
      }
      indexCache = parsed.filter(isValidEntry);
      return indexCache;
    } catch (err) {
      log.warn('failed to load prompt search index', { err });
      indexCache = [];
      return indexCache;
    } finally {
      indexLoadPromise = null;
    }
  })();
  return indexLoadPromise;
}

function isValidEntry(value: unknown): value is PromptSearchIndexEntry {
  if (!value || typeof value !== 'object') return false;
  const o = value as Record<string, unknown>;
  return (
    typeof o.conversationId === 'string' &&
    typeof o.eventId === 'string' &&
    typeof o.workspaceId === 'string' &&
    typeof o.excerpt === 'string' &&
    typeof o.ts === 'number'
  );
}

async function persistIndex(entries: PromptSearchIndexEntry[]): Promise<void> {
  indexCache = entries;
  const path = indexPath();
  const dir = conversationsDir();
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${path}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(entries), 'utf8');
  await fs.rename(tmp, path);
}

export async function appendPromptSearchIndexEntry(entry: PromptSearchIndexEntry): Promise<void> {
  const list = await loadIndex();
  const next = [...list, entry];
  const trimmed =
    next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next;
  try {
    await persistIndex(trimmed);
  } catch (err) {
    log.warn('failed to persist prompt search index', { err });
  }
}

export function makePromptSearchIndexEntry(opts: {
  conversationId: string;
  eventId: string;
  workspaceId: string;
  content: string;
  ts: number;
}): PromptSearchIndexEntry | null {
  const excerpt = redactSensitiveText(opts.content.trim()).slice(0, EXCERPT_MAX);
  if (!excerpt) return null;
  return {
    conversationId: opts.conversationId,
    eventId: opts.eventId,
    workspaceId: opts.workspaceId,
    excerpt,
    ts: opts.ts
  };
}

export async function indexUserPromptEvent(opts: {
  conversationId: string;
  eventId: string;
  workspaceId: string | undefined;
  content: string;
  ts: number;
}): Promise<void> {
  if (!opts.workspaceId) return;
  const entry = makePromptSearchIndexEntry({
    conversationId: opts.conversationId,
    eventId: opts.eventId,
    workspaceId: opts.workspaceId,
    content: opts.content,
    ts: opts.ts
  });
  if (!entry) return;
  await appendPromptSearchIndexEntry(entry);
}

/** Merge deduped entries from transcript backfill (boot-time, idempotent). */
export async function mergePromptSearchIndexEntries(
  entries: PromptSearchIndexEntry[]
): Promise<number> {
  if (entries.length === 0) return 0;
  const list = await loadIndex();
  const known = new Set(list.map((e) => e.eventId));
  const toAdd = entries.filter((e) => !known.has(e.eventId));
  if (toAdd.length === 0) return 0;
  const merged = [...list, ...toAdd];
  const trimmed =
    merged.length > MAX_ENTRIES ? merged.slice(merged.length - MAX_ENTRIES) : merged;
  try {
    await persistIndex(trimmed);
  } catch (err) {
    log.warn('failed to merge prompt search index entries', { err });
    return 0;
  }
  return toAdd.length;
}

/** Drop all index rows for a removed conversation (best-effort). */
export async function removePromptSearchEntriesForConversation(
  conversationId: string
): Promise<number> {
  const list = await loadIndex();
  const filtered = list.filter((e) => e.conversationId !== conversationId);
  if (filtered.length === list.length) return 0;
  try {
    await persistIndex(filtered);
  } catch (err) {
    log.warn('failed to remove prompt search index entries for conversation', {
      conversationId,
      err
    });
    return 0;
  }
  return list.length - filtered.length;
}

/** Drop index rows whose conversation is absent from the live conversation index. */
export async function prunePromptSearchIndexToKnownConversations(
  knownConversationIds: ReadonlySet<string>
): Promise<number> {
  const list = await loadIndex();
  const filtered = list.filter((e) => knownConversationIds.has(e.conversationId));
  if (filtered.length === list.length) return 0;
  try {
    await persistIndex(filtered);
  } catch (err) {
    log.warn('failed to prune orphan prompt search index entries', { err });
    return 0;
  }
  return list.length - filtered.length;
}

export async function searchPromptIndex(
  workspaceId: string,
  query: string,
  limit = SEARCH_RESULT_LIMIT
): Promise<PromptSearchIndexEntry[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const list = await loadIndex();
  const hits: PromptSearchIndexEntry[] = [];
  for (let i = list.length - 1; i >= 0; i--) {
    const entry = list[i]!;
    if (entry.workspaceId !== workspaceId) continue;
    if (!entry.excerpt.toLowerCase().includes(q)) continue;
    hits.push(entry);
    if (hits.length >= limit) break;
  }
  return hits;
}

/** Test helper — reset in-memory cache. */
export function resetPromptSearchIndexCacheForTests(): void {
  indexCache = null;
  indexLoadPromise = null;
}
