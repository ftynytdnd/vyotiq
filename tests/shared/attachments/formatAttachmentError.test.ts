import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_ERROR_NOT_A_FILE,
  ATTACHMENT_ERROR_NOT_FOUND,
  formatAttachmentErrorReason
} from '@shared/attachments/formatAttachmentError';

describe('formatAttachmentErrorReason', () => {
  it('maps ENOENT stat errors to a friendly message', () => {
    expect(
      formatAttachmentErrorReason(
        "ENOENT: no such file or directory, stat 'C:\\\\review-bugbot'"
      )
    ).toBe(ATTACHMENT_ERROR_NOT_FOUND);
  });

  it('maps Not a file rejections to folder guidance', () => {
    expect(formatAttachmentErrorReason('Not a file')).toBe(ATTACHMENT_ERROR_NOT_A_FILE);
  });

  it('preserves size-limit messages', () => {
    expect(formatAttachmentErrorReason('huge.zip exceeds 10 MB limit')).toBe(
      'huge.zip exceeds 10 MB limit'
    );
  });
});
