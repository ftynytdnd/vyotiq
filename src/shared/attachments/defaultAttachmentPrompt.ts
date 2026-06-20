import type { PromptAttachmentMeta } from '../types/chat.js';
import { mediaKindFromMeta } from './mediaKind.js';

/** Placeholder user text when sending attachments without a typed prompt. */
export function defaultAttachmentPrompt(attachments: PromptAttachmentMeta[]): string {
  if (attachments.length === 0) return '';
  const kinds = attachments.map(
    (m) => m.mediaKind ?? mediaKindFromMeta({ name: m.name, mimeType: m.mimeType })
  );
  if (kinds.every((k) => k === 'image')) {
    return attachments.length === 1 ? 'See attached screenshot.' : 'See attached screenshots.';
  }
  return 'See attached files.';
}
