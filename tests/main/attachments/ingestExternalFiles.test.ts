import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { MAX_ATTACHMENT_IMAGE_BYTES } from '@shared/constants';
import { formatAttachmentSizeLimitError } from '@shared/attachments/attachmentSizeLimits';
import { ingestExternalFiles } from '@main/attachments/ingest';

describe('ingestExternalFiles', () => {
  it('skips oversize files without failing the batch', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vyotiq-ingest-batch-'));
    const smallPath = join(dir, 'small.png');
    const bigPath = join(dir, 'big.png');
    await mkdir(dir, { recursive: true });
    await writeFile(smallPath, 'hello');
    await writeFile(bigPath, Buffer.alloc(MAX_ATTACHMENT_IMAGE_BYTES + 1));

    const { ingested, rejected } = await ingestExternalFiles([smallPath, bigPath], {
      workspaceId: 'ws-1',
      conversationId: 'conv-1',
      messageId: 'msg-1'
    });

    expect(ingested).toHaveLength(1);
    expect(ingested[0]?.name).toBe('small.png');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.name).toBe('big.png');
    expect(rejected[0]?.reason).toBe(
      formatAttachmentSizeLimitError('big.png', MAX_ATTACHMENT_IMAGE_BYTES)
    );
  });

  it('returns friendly ENOENT reasons for missing paths', async () => {
    const { ingested, rejected } = await ingestExternalFiles(
      ['C:\\missing\\review-bugbot.png'],
      {
        workspaceId: 'ws-1',
        conversationId: 'conv-1',
        messageId: 'msg-1'
      }
    );

    expect(ingested).toHaveLength(0);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBe(
      'Could not find that file to attach. Try capturing or attaching again.'
    );
  });
});
