/**
 * Pre-IPC size checks for pasted file blobs (renderer → main).
 */

import { mediaKindFromMeta } from './mediaKind.js';
import { MAX_ATTACHMENT_FILE_BYTES, VISION_VIDEO_MAX_BYTES } from '../constants.js';

export function maxBytesForMime(mimeType: string, name: string): number {
  const kind = mediaKindFromMeta({ name, mimeType });
  return kind === 'video' ? VISION_VIDEO_MAX_BYTES : MAX_ATTACHMENT_FILE_BYTES;
}

export function filterClipboardBlobsWithinLimits<
  T extends { name: string; mimeType: string; data: ArrayBuffer }
>(blobs: T[]): { accepted: T[]; rejected: T[] } {
  const accepted: T[] = [];
  const rejected: T[] = [];
  for (const blob of blobs) {
    const cap = maxBytesForMime(blob.mimeType, blob.name);
    if (blob.data.byteLength > cap) {
      rejected.push(blob);
    } else {
      accepted.push(blob);
    }
  }
  return { accepted, rejected };
}
