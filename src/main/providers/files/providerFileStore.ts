/**
 * Persist provider-uploaded file IDs keyed by (providerId, contentHash).
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { vyotiqDataPath } from '../../paths/userDataLayout.js';

const STORE_FILE = 'provider-files.json';

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
    cache = JSON.parse(raw) as ProviderFileStoreData;
  } catch {
    cache = { entries: [] };
  }
  return cache;
}

async function persist(data: ProviderFileStoreData): Promise<void> {
  cache = data;
  await mkdir(vyotiqDataPath(), { recursive: true });
  await writeFile(storePath(), JSON.stringify(data, null, 2), 'utf8');
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

/** Test helper — reset in-memory cache. */
export function resetProviderFileStoreCache(): void {
  cache = null;
}
