/**
 * Persist provider-uploaded file IDs keyed by (providerId, contentHash).
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { vyotiqDataPath } from '../../paths/userDataLayout.js';
import { logger } from '../../logging/logger.js';

const STORE_FILE = 'provider-files.json';

const log = logger.child('providers/files/store');

export interface StoredProviderFile {
  providerId: string;
  contentHash: string;
  fileId: string;
  mime: string;
  uploadedAt: number;
  /** Provider-specific expiry (e.g. Gemini 48h). */
  expiresAt?: number;
}

interface ProviderFileStoreData {
  entries: StoredProviderFile[];
}

let cache: ProviderFileStoreData | null = null;

function storePath(): string {
  return vyotiqDataPath(STORE_FILE);
}

async function load(): Promise<ProviderFileStoreData> {
  if (cache) return cache;
  try {
    const raw = await readFile(storePath(), 'utf8');
    const parsed = JSON.parse(raw) as ProviderFileStoreData;
    // Shape guard: a file that is valid JSON but the wrong shape (e.g.
    // `{}`, `[]`, or a truncated object missing `entries`) must not be
    // handed downstream where `data.entries.find(...)` would throw on
    // every lookup. Reset to empty in that case — same outcome as a
    // missing file.
    cache = Array.isArray(parsed?.entries) ? parsed : { entries: [] };
  } catch (err: unknown) {
    // A missing file is the normal first-run case — silent. Any other
    // failure (corruption, decode error, permission flap) is a real
    // signal worth a breadcrumb: silently resetting to empty here
    // discards every cached upload mapping and forces a full re-upload
    // with no trace. Log it, then degrade to empty so callers proceed.
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      log.warn('provider file store unreadable; starting empty', { err });
    }
    cache = { entries: [] };
  }
  return cache;
}

async function persist(data: ProviderFileStoreData): Promise<void> {
  await mkdir(vyotiqDataPath(), { recursive: true });
  await writeFile(storePath(), JSON.stringify(data, null, 2), 'utf8');
  cache = data;
}

function storeKey(providerId: string, contentHash: string): string {
  return `${providerId}:${contentHash}`;
}

export async function getStoredProviderFile(
  providerId: string,
  contentHash: string
): Promise<StoredProviderFile | undefined> {
  const data = await load();
  const now = Date.now();
  const hit = data.entries.find(
    (e) =>
      storeKey(e.providerId, e.contentHash) === storeKey(providerId, contentHash) &&
      (e.expiresAt == null || e.expiresAt > now)
  );
  return hit;
}

export async function putStoredProviderFile(entry: StoredProviderFile): Promise<void> {
  const data = await load();
  const key = storeKey(entry.providerId, entry.contentHash);
  data.entries = data.entries.filter(
    (e) => storeKey(e.providerId, e.contentHash) !== key
  );
  data.entries.push(entry);
  if (data.entries.length > 500) {
    data.entries.sort((a, b) => b.uploadedAt - a.uploadedAt);
    data.entries = data.entries.slice(0, 500);
  }
  await persist(data);
}
