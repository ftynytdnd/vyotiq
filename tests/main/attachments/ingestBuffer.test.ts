import { describe, expect, it, vi, afterEach } from 'vitest';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { ingestBuffer } from '@main/attachments/ingest.js';

const electronRoot = { path: '' };

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return electronRoot.path;
      return electronRoot.path;
    }
  }
}));

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

describe('ingestBuffer', () => {
  afterEach(async () => {
    if (electronRoot.path) {
      await rm(electronRoot.path, { recursive: true, force: true });
      electronRoot.path = '';
    }
  });

  it('writes clipboard PNG bytes into the attachment store', async () => {
    electronRoot.path = await mkdtemp(join(tmpdir(), 'vyotiq-ingest-buffer-'));

    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const meta = await ingestBuffer({
      buffer: png,
      suggestedName: 'clipboard.png',
      mimeType: 'image/png',
      workspaceId: 'ws',
      conversationId: 'conv',
      messageId: 'msg'
    });

    expect(meta.mediaKind).toBe('image');
    expect(meta.storedPath).toBeTruthy();
    const st = await stat(meta.storedPath!);
    expect(st.size).toBe(png.length);
    const onDisk = await readFile(meta.storedPath!);
    expect(onDisk.equals(png)).toBe(true);
  });
});
