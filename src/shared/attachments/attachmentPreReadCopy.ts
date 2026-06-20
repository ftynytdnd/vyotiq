import type { AttachmentMediaKind } from '../types/chat.js';

/** User-facing timeline copy for host attachment warm-up telemetry. */
export function attachmentPreReadCopy(path: string, mediaKind?: AttachmentMediaKind): string {
  const file = `\`${path}\``;
  switch (mediaKind) {
    case 'image':
      return `Screenshot attached — ${file} sent to vision for this run`;
    case 'pdf':
      return `PDF attached — ${file} sent to vision for this run`;
    case 'video':
      return `Video attached — ${file} sent to vision for this run`;
    case 'audio':
      return `Audio attached — ${file} sent to vision for this run`;
    case 'text':
      return `File attached — ${file} inlined for this run`;
    default:
      return `Attachment added — ${file}`;
  }
}
