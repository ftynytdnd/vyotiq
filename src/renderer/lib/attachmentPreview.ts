/**
 * Attachment in-app preview classification (workbench Preview tab).
 */

import { mediaKindFromMeta } from '@shared/attachments/mediaKind.js';
import type { AttachmentMediaKind, PromptAttachmentMeta } from '@shared/types/chat.js';

const TEXT_PREVIEW_EXT =
  /\.(txt|md|json|ya?ml|xml|csv|log|ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|kt|cs|cpp|c|h|css|html?)$/i;

export type AttachmentPreviewKind = 'image' | 'pdf' | 'video' | 'audio' | 'text' | 'none';

export function attachmentMediaKind(meta: PromptAttachmentMeta): AttachmentMediaKind {
  return meta.mediaKind ?? mediaKindFromMeta(meta);
}

export function attachmentPreviewKind(meta: PromptAttachmentMeta): AttachmentPreviewKind {
  const kind = attachmentMediaKind(meta);
  switch (kind) {
    case 'image':
      return 'image';
    case 'pdf':
      return 'pdf';
    case 'video':
      return 'video';
    case 'audio':
      return 'audio';
    case 'text':
      return isTextPreviewAttachment(meta) ? 'text' : 'none';
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

export function isTextPreviewAttachment(meta: PromptAttachmentMeta): boolean {
  const mime = meta.mimeType?.toLowerCase() ?? '';
  if (mime.startsWith('text/') || mime === 'application/json') return true;
  return TEXT_PREVIEW_EXT.test(meta.name);
}

export function canPreviewAttachmentInApp(attachment: PromptAttachmentMeta): boolean {
  return attachmentPreviewKind(attachment) !== 'none';
}

export function attachmentPreviewUsesFileUrl(kind: AttachmentPreviewKind): boolean {
  return kind === 'image' || kind === 'pdf' || kind === 'video' || kind === 'audio';
}
