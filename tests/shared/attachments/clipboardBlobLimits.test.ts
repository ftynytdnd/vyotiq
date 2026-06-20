import { describe, expect, it } from 'vitest';
import { filterClipboardBlobsWithinLimits } from '@shared/attachments/clipboardBlobLimits.js';
import { MAX_ATTACHMENT_IMAGE_BYTES } from '@shared/constants.js';

describe('clipboardBlobLimits', () => {
  it('rejects blobs over the cap before IPC', () => {
    const big = new ArrayBuffer(MAX_ATTACHMENT_IMAGE_BYTES + 1);
    const small = new ArrayBuffer(8);
    const { accepted, rejected } = filterClipboardBlobsWithinLimits([
      { name: 'big.png', mimeType: 'image/png', data: big },
      { name: 'ok.png', mimeType: 'image/png', data: small }
    ]);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]?.name).toBe('ok.png');
    expect(rejected).toHaveLength(1);
  });
});
