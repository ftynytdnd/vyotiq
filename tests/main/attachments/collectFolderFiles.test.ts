/**
 * `collectFolderFiles` — recursive folder walk with workspace ignore rules.
 */

import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectFolderFiles } from '@main/attachments/collectFolderFiles';

let root = '';

beforeEach(async () => {
  root = join(tmpdir(), `vyotiq-collect-folder-${Date.now()}`);
  await mkdir(root, { recursive: true });
  await mkdir(join(root, 'src'), { recursive: true });
  await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true });
  await writeFile(join(root, 'src', 'a.ts'), 'a');
  await writeFile(join(root, 'src', 'b.ts'), 'b');
  await writeFile(join(root, 'node_modules', 'pkg', 'ignored.js'), 'x');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('collectFolderFiles', () => {
  it('collects files under a folder and skips ignored dirs', async () => {
    const result = await collectFolderFiles(root, 'src', 10);
    expect(result.paths.sort()).toEqual(['src/a.ts', 'src/b.ts']);
    expect(result.total).toBe(2);
    expect(result.truncated).toBe(false);
  });

  it('caps results and reports truncation', async () => {
    const result = await collectFolderFiles(root, '', 1);
    expect(result.paths).toHaveLength(1);
    expect(result.total).toBeGreaterThan(1);
    expect(result.truncated).toBe(true);
  });
});
