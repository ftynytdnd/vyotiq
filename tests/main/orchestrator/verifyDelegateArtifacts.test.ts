/**
 * verifyDelegateArtifacts — host FS checks after delegation.
 */

import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  formatHostVerificationXml,
  verifyDelegateArtifacts
} from '@main/orchestrator/verifyDelegateArtifacts.js';

describe('verifyDelegateArtifacts', () => {
  it('skips read-only tasks', async () => {
    const lines = await verifyDelegateArtifacts(
      [{ id: 'A1', task: 'Read src/foo.ts and summarize', files: ['src/foo.ts'] }],
      '/tmp/workspace'
    );
    expect(lines).toEqual([]);
  });

  it('checks resolved files for fix/update tasks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vyotiq-verify-'));
    const rel = 'src/app.ts';
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, rel), 'export const ok = true;\n', 'utf8');

    const lines = await verifyDelegateArtifacts(
      [{ id: 'A1', task: 'Fix the bootstrap in app.ts', files: [rel] }],
      root
    );
    expect(lines).toEqual([{ path: rel, ok: true, detail: expect.stringContaining('bytes') }]);
  });

  it('reports missing files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vyotiq-verify-'));
    const lines = await verifyDelegateArtifacts(
      [{ id: 'A1', task: 'Update missing.ts', files: ['missing.ts'] }],
      root
    );
    expect(lines).toEqual([{ path: 'missing.ts', ok: false, detail: 'missing' }]);
  });
});

describe('formatHostVerificationXml', () => {
  it('escapes quotes and angle brackets in paths and details', () => {
    const xml = formatHostVerificationXml([
      {
        path: 'src/"tricky".ts',
        ok: false,
        detail: 'bad <tag> & "quote"'
      }
    ]);
    expect(xml).toContain('path="src/&quot;tricky&quot;.ts"');
    expect(xml).toContain('bad &lt;tag&gt; &amp; "quote"');
    expect(xml).not.toContain('path="src/"tricky""');
  });
});
