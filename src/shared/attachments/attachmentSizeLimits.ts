/**
 * Per-attachment byte caps (shared by clipboard paste, file pick, and ingest).
 * Ingest limits align with native vision wire caps where the file is sent to the model.
 */

import type { AttachmentMediaKind } from '../types/chat.js';
import {
  MAX_ATTACHMENT_FILE_BYTES,
  MAX_ATTACHMENT_IMAGE_BYTES,
  VISION_AUDIO_MAX_BYTES,
  VISION_PDF_MAX_BYTES,
  VISION_VIDEO_MAX_BYTES
} from '../constants.js';
import { guessMimeFromName, mediaKindFromMeta } from './mediaKind.js';

export function maxBytesForAttachmentKind(kind: AttachmentMediaKind): number {
  switch (kind) {
    case 'image':
      return MAX_ATTACHMENT_IMAGE_BYTES;
    case 'pdf':
      return VISION_PDF_MAX_BYTES;
    case 'video':
      return VISION_VIDEO_MAX_BYTES;
    case 'audio':
      return VISION_AUDIO_MAX_BYTES;
    case 'text':
      return MAX_ATTACHMENT_FILE_BYTES;
    default: {
      const _exhaustive: never = kind;
      void _exhaustive;
      return MAX_ATTACHMENT_FILE_BYTES;
    }
  }
}

export function maxBytesForAttachment(meta: { name: string; mimeType?: string }): number {
  const mimeType = meta.mimeType ?? guessMimeFromName(meta.name);
  const kind = mediaKindFromMeta({ name: meta.name, mimeType });
  return maxBytesForAttachmentKind(kind);
}

export function attachmentSizeLimitMb(capBytes: number): number {
  return capBytes / (1024 * 1024);
}

export function formatAttachmentSizeLimitError(name: string, capBytes: number): string {
  const mb = attachmentSizeLimitMb(capBytes);
  const label = Number.isInteger(mb) ? String(mb) : mb.toFixed(1);
  return `${name} exceeds ${label} MB limit`;
}

/** Short composer tooltip summarizing per-kind ingest caps. */
export function attachmentIngestLimitHint(): string {
  return 'Attach file (10 MB text, 20 MB images/audio, 25 MB PDF/video)';
}
