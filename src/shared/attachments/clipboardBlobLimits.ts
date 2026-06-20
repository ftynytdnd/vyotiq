/**
 * Pre-IPC size checks for pasted file blobs (renderer → main).
 */

import { maxBytesForAttachment } from './attachmentSizeLimits.js';

export function maxBytesForMime(mimeType: string, name: string): number {
  return maxBytesForAttachment({ name, mimeType });
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
