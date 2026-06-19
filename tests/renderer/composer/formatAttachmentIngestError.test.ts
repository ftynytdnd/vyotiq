import { describe, expect, it } from 'vitest';
import { formatAttachmentIngestError } from '@renderer/components/composer/formatAttachmentIngestError';

describe('formatAttachmentIngestError', () => {
  it('maps ENOENT IPC errors to a friendly message', () => {
    const msg = formatAttachmentIngestError(
      new Error(
        "Error invoking remote method 'attachments:ingest-paths': Error: ENOENT: no such file or directory, stat 'C:\\\\x\\\\.vyotiq\\\\captures\\\\screen-1.png'"
      )
    );
    expect(msg).toBe('Could not find that file to attach. Try capturing or attaching again.');
  });
});
