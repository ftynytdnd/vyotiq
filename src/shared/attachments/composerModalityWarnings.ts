/**
 * Pre-send composer warnings when attachments exceed model input modalities.
 */

import type { AttachmentMediaKind, PromptAttachmentMeta } from '../types/chat.js';
import type { ModelInputModality } from '../types/provider.js';
import { mediaKindFromMeta } from './mediaKind.js';
import {
  modelSupportsAudioNative,
  modelSupportsPdfNative,
  modelSupportsVideoNative,
  modelSupportsVision
} from '../providers/visionCapabilities.js';

function modelSupportsNativeMedia(
  kind: AttachmentMediaKind,
  modalities: ModelInputModality[] | undefined
): boolean {
  switch (kind) {
    case 'image':
      return modelSupportsVision(modalities);
    case 'pdf':
      return modelSupportsPdfNative(modalities);
    case 'video':
      return modelSupportsVideoNative(modalities);
    case 'audio':
      return modelSupportsAudioNative(modalities);
    default:
      return true;
  }
}

const NATIVE_MEDIA_LABEL: Partial<Record<AttachmentMediaKind, string>> = {
  image: 'images',
  pdf: 'PDFs',
  video: 'video',
  audio: 'audio'
};

export interface ComposerModalityWarnings {
  visionWarning: boolean;
  pdfWarning: boolean;
  videoWarning: boolean;
  audioWarning: boolean;
}

export function computeComposerModalityWarnings(
  attachmentMeta: PromptAttachmentMeta[],
  modalities: ModelInputModality[] | undefined
): ComposerModalityWarnings {
  let visionWarning = false;
  let pdfWarning = false;
  let videoWarning = false;
  let audioWarning = false;

  for (const meta of attachmentMeta) {
    const kind = meta.mediaKind ?? mediaKindFromMeta(meta);
    if (kind === 'text') continue;
    if (modelSupportsNativeMedia(kind, modalities)) continue;
    switch (kind) {
      case 'image':
        visionWarning = true;
        break;
      case 'pdf':
        pdfWarning = true;
        break;
      case 'video':
        videoWarning = true;
        break;
      case 'audio':
        audioWarning = true;
        break;
      default:
        break;
    }
  }

  return { visionWarning, pdfWarning, videoWarning, audioWarning };
}

/** Human-readable unsupported media kinds for toast copy. */
export function unsupportedNativeMediaLabel(
  attachmentMeta: PromptAttachmentMeta[],
  modalities: ModelInputModality[] | undefined
): string | null {
  const unsupported = new Set<string>();
  for (const meta of attachmentMeta) {
    const kind = meta.mediaKind ?? mediaKindFromMeta(meta);
    if (kind === 'text') continue;
    if (!modelSupportsNativeMedia(kind, modalities)) {
      const label = NATIVE_MEDIA_LABEL[kind] ?? kind;
      unsupported.add(label);
    }
  }
  if (unsupported.size === 0) return null;
  return [...unsupported].join(', ');
}
