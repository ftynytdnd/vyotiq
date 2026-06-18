import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  getPreparedMediaFromDisk,
  hashPreprocessedBytes,
  putPreparedMediaOnDisk
} from '@main/attachments/preparedMediaDiskCache.js';
import type { PreparedVisionMedia } from '@main/attachments/prepareMediaForVision.js';

let cacheDir = '';

vi.mock('@main/paths/userDataLayout.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/paths/userDataLayout.js')>();
  return {
    ...actual,
    visionCacheDir: () => cacheDir
  };
});

describe('preparedMediaDiskCache', () => {
  beforeEach(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), 'vyotiq-vision-cache-'));
  });

  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true });
  });

  it('round-trips prepared media by content hash', async () => {
    const buffer = Buffer.from('preprocessed-bytes');
    const hash = hashPreprocessedBytes(buffer);
    const prepared: PreparedVisionMedia = {
      part: {
        type: 'image_url',
        image_url: { url: 'data:image/jpeg;base64,YWJj' }
      },
      encodedBytes: buffer.length,
      width: 10,
      height: 10,
      imageTokenEstimate: 42
    };
    await putPreparedMediaOnDisk(hash, buffer, prepared);
    const loaded = await getPreparedMediaFromDisk(hash);
    expect(loaded?.part.type).toBe('image_url');
    expect(loaded?.width).toBe(10);
    expect(loaded?.imageTokenEstimate).toBe(42);
  });
});
