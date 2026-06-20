import { describe, expect, it } from 'vitest';
import {
  MAX_ATTACHMENT_FILE_BYTES,
  MAX_ATTACHMENT_IMAGE_BYTES,
  VISION_AUDIO_MAX_BYTES,
  VISION_PDF_MAX_BYTES,
  VISION_VIDEO_MAX_BYTES
} from '@shared/constants';
import {
  attachmentIngestLimitHint,
  formatAttachmentSizeLimitError,
  maxBytesForAttachment,
  maxBytesForAttachmentKind
} from '@shared/attachments/attachmentSizeLimits';

describe('attachmentSizeLimits', () => {
  it('applies per-kind ingest caps aligned with vision wire limits', () => {
    expect(maxBytesForAttachmentKind('image')).toBe(MAX_ATTACHMENT_IMAGE_BYTES);
    expect(maxBytesForAttachmentKind('pdf')).toBe(VISION_PDF_MAX_BYTES);
    expect(maxBytesForAttachmentKind('video')).toBe(VISION_VIDEO_MAX_BYTES);
    expect(maxBytesForAttachmentKind('audio')).toBe(VISION_AUDIO_MAX_BYTES);
    expect(maxBytesForAttachmentKind('text')).toBe(MAX_ATTACHMENT_FILE_BYTES);
  });

  it('infers caps from file names', () => {
    expect(maxBytesForAttachment({ name: 'shot.png', mimeType: 'image/png' })).toBe(
      MAX_ATTACHMENT_IMAGE_BYTES
    );
    expect(maxBytesForAttachment({ name: 'report.pdf' })).toBe(VISION_PDF_MAX_BYTES);
    expect(maxBytesForAttachment({ name: 'clip.mp4', mimeType: 'video/mp4' })).toBe(
      VISION_VIDEO_MAX_BYTES
    );
    expect(maxBytesForAttachment({ name: 'notes.md' })).toBe(MAX_ATTACHMENT_FILE_BYTES);
  });

  it('formats limit errors with fractional MB when needed', () => {
    expect(formatAttachmentSizeLimitError('huge.zip', MAX_ATTACHMENT_FILE_BYTES)).toBe(
      'huge.zip exceeds 10 MB limit'
    );
  });

  it('summarizes limits for the attach button tooltip', () => {
    expect(attachmentIngestLimitHint()).toContain('20 MB');
    expect(attachmentIngestLimitHint()).toContain('25 MB');
  });
});
