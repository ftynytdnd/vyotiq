/**
 * Disk-backed LRU cache for preprocessed vision media bytes.
 * Keyed by SHA-256 of preprocessed buffer (not raw upload).
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { VISION_DISK_CACHE_MAX_BYTES } from '@shared/constants.js';
import type { ChatContentPart } from '@shared/types/chat.js';
import { visionCacheDir } from '../paths/userDataLayout.js';
import { logger } from '../logging/logger.js';
import type { PreparedVisionMedia } from './prepareMediaForVision.js';

const log = logger.child('attachments/visionDiskCache');

export interface VisionDiskCacheMeta {
  hash: string;
  mime: string;
  encodedBytes: number;
  width?: number;
  height?: number;
  imageTokenEstimate?: number;
  partType: ChatContentPart['type'];
  /** Serialized part payload (data URL or nested fields). */
  partJson: string;
  lastAccessedAt: number;
}

function cacheRoot(): string {
  return visionCacheDir();
}

function binPath(hash: string): string {
  return join(cacheRoot(), `${hash}.bin`);
}

function metaPath(hash: string): string {
  return join(cacheRoot(), `${hash}.meta.json`);
}

export function hashPreprocessedBytes(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

async function ensureDir(): Promise<void> {
  await mkdir(cacheRoot(), { recursive: true });
}

function partFromMeta(meta: VisionDiskCacheMeta): ChatContentPart {
  return JSON.parse(meta.partJson) as ChatContentPart;
}

function metaFromPrepared(hash: string, prepared: PreparedVisionMedia): VisionDiskCacheMeta {
  return {
    hash,
    mime:
      prepared.part.type === 'image_url'
        ? prepared.part.image_url.url.match(/^data:([^;]+);/)?.[1] ?? 'image/jpeg'
        : prepared.part.type === 'file'
          ? 'application/pdf'
          : prepared.part.type === 'video_url'
            ? prepared.part.video_url.url.match(/^data:([^;]+);/)?.[1] ?? 'video/mp4'
            : 'application/octet-stream',
    encodedBytes: prepared.encodedBytes,
    width: prepared.width,
    height: prepared.height,
    imageTokenEstimate: prepared.imageTokenEstimate,
    partType: prepared.part.type,
    partJson: JSON.stringify(prepared.part),
    lastAccessedAt: Date.now()
  };
}

export async function getPreparedMediaFromDisk(
  hash: string
): Promise<PreparedVisionMedia | undefined> {
  try {
    const metaRaw = await readFile(metaPath(hash), 'utf8');
    const meta = JSON.parse(metaRaw) as VisionDiskCacheMeta;
    const part = partFromMeta(meta);
    meta.lastAccessedAt = Date.now();
    await writeFile(metaPath(hash), JSON.stringify(meta), 'utf8');
    return {
      part,
      width: meta.width,
      height: meta.height,
      encodedBytes: meta.encodedBytes,
      imageTokenEstimate: meta.imageTokenEstimate,
      hash
    };
  } catch {
    return undefined;
  }
}

export async function putPreparedMediaOnDisk(
  hash: string,
  buffer: Buffer,
  prepared: PreparedVisionMedia
): Promise<void> {
  await ensureDir();
  const meta = metaFromPrepared(hash, prepared);
  await writeFile(binPath(hash), buffer);
  await writeFile(metaPath(hash), JSON.stringify(meta), 'utf8');
  await evictVisionDiskCacheIfNeeded();
}

async function totalCacheBytes(): Promise<number> {
  let total = 0;
  try {
    const entries = await readdir(cacheRoot());
    for (const name of entries) {
      if (!name.endsWith('.bin')) continue;
      const st = await stat(join(cacheRoot(), name));
      total += st.size;
    }
  } catch {
    return 0;
  }
  return total;
}

/** Evict oldest-accessed entries until under quota. */
export async function evictVisionDiskCacheIfNeeded(): Promise<number> {
  let evicted = 0;
  try {
    const entries = await readdir(cacheRoot());
    const metas: VisionDiskCacheMeta[] = [];
    for (const name of entries) {
      if (!name.endsWith('.meta.json')) continue;
      try {
        const raw = await readFile(join(cacheRoot(), name), 'utf8');
        metas.push(JSON.parse(raw) as VisionDiskCacheMeta);
      } catch {
        // skip corrupt meta
      }
    }
    let total = await totalCacheBytes();
    metas.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);
    for (const meta of metas) {
      if (total <= VISION_DISK_CACHE_MAX_BYTES) break;
      try {
        await rm(binPath(meta.hash), { force: true });
        await rm(metaPath(meta.hash), { force: true });
        total -= meta.encodedBytes;
        evicted += 1;
      } catch (err: unknown) {
        log.debug('vision disk cache evict failed', { hash: meta.hash, err });
      }
    }
  } catch {
    // cache dir may not exist yet
  }
  return evicted;
}

/** Boot sweeper — reclaim space when over quota. */
export async function sweepVisionDiskCache(): Promise<number> {
  return evictVisionDiskCacheIfNeeded();
}
