import { describe, expect, it, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let checkpointsRoot = '';

vi.mock('@main/paths/userDataLayout.js', () => ({
  checkpointsDir: () => join(checkpointsRoot, 'checkpoints')
}));

import { writeBlob, hashContent } from '@main/checkpoints/blobStore.js';
import { blobPath } from '@main/checkpoints/paths.js';

describe('blobStore writeBlob', () => {
  afterEach(async () => {
    if (checkpointsRoot) {
      await rm(checkpointsRoot, { recursive: true, force: true }).catch(() => undefined);
      checkpointsRoot = '';
    }
  });

  it('dedupes identical content and survives concurrent writers', async () => {
    checkpointsRoot = await mkdtemp(join(tmpdir(), 'vyotiq-blobs-'));
    const workspaceId = 'ws-blob-test';
    const content = 'same checkpoint body\n';

    const [h1, h2, h3] = await Promise.all([
      writeBlob(workspaceId, content),
      writeBlob(workspaceId, content),
      writeBlob(workspaceId, content)
    ]);

    const expected = hashContent(content);
    expect(h1).toBe(expected);
    expect(h2).toBe(expected);
    expect(h3).toBe(expected);

    const body = await readFile(blobPath(workspaceId, expected), 'utf8');
    expect(body).toBe(content);
  });
});
