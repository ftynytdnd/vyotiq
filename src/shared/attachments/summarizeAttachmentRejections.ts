/**
 * User-facing copy when attachment ingest skips one or more files.
 */

import { formatAttachmentErrorReason } from './formatAttachmentError.js';

export interface AttachmentIngestRejection {
  name: string;
  reason: string;
}

export function summarizeAttachmentRejections(
  rejected: AttachmentIngestRejection[]
): string | null {
  if (rejected.length === 0) return null;
  if (rejected.length === 1) return formatAttachmentErrorReason(rejected[0]!.reason);
  const allSizeLimited = rejected.every((r) => /exceeds \d+(\.\d+)? MB limit/i.test(r.reason));
  if (allSizeLimited) {
    return `${rejected.length} files exceed the size limit and were skipped.`;
  }
  return `${rejected.length} files could not be attached and were skipped.`;
}
