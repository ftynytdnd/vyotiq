/**
 * Resolve provider file_id references for multimodal content parts.
 */

import type { ChatContentPart } from '@shared/types/chat.js';
import type { ProviderWithKey } from '@shared/types/provider.js';
import { isChatContentPartArray } from '@shared/text/chatContent.js';
import { parseDataUrl } from '../multimodal/parseDataUrl.js';
import { ensureProviderFileUploaded } from './uploadProviderFile.js';

export interface ContentPartFileRef {
  fileId: string;
  mime: string;
}

/** Parallel to content parts array — undefined where no file ref applies. */
export type ContentPartFileRefs = Array<ContentPartFileRef | undefined>;

function bufferFromBase64(base64: string): Buffer {
  return Buffer.from(base64, 'base64');
}

function defaultFilename(mime: string, index: number): string {
  const ext =
    mime === 'image/png'
      ? 'png'
      : mime === 'image/jpeg'
        ? 'jpg'
        : mime === 'application/pdf'
          ? 'pdf'
          : mime.startsWith('video/')
            ? 'mp4'
            : mime.startsWith('audio/')
              ? 'wav'
              : 'bin';
  return `vyotiq-media-${index}.${ext}`;
}

export async function resolveFileRefsForUserContent(
  provider: ProviderWithKey,
  content: string | ChatContentPart[] | null | undefined
): Promise<ContentPartFileRefs | undefined> {
  if (!isChatContentPartArray(content)) return undefined;
  const refs: ContentPartFileRefs = [];
  let hasAny = false;
  for (let i = 0; i < content.length; i++) {
    const part = content[i]!;
    let url: string | undefined;
    let filename = defaultFilename('application/octet-stream', i);
    switch (part.type) {
      case 'image_url':
        url = part.image_url.url;
        filename = defaultFilename('image/jpeg', i);
        break;
      case 'file':
        url = part.file.file_data;
        filename = part.file.filename || filename;
        break;
      case 'video_url':
        url = part.video_url.url;
        break;
      case 'input_audio':
        refs.push(undefined);
        continue;
      case 'text':
        refs.push(undefined);
        continue;
      default: {
        const _exhaustive: never = part;
        void _exhaustive;
        refs.push(undefined);
        continue;
      }
    }
    if (!url) {
      refs.push(undefined);
      continue;
    }
    const parsed = parseDataUrl(url);
    if (!parsed) {
      refs.push(undefined);
      continue;
    }
    const uploaded = await ensureProviderFileUploaded(
      provider,
      bufferFromBase64(parsed.base64),
      parsed.mime,
      filename
    );
    if (uploaded) {
      refs.push({ fileId: uploaded.fileId, mime: uploaded.mime });
      hasAny = true;
    } else {
      refs.push(undefined);
    }
  }
  return hasAny ? refs : undefined;
}
