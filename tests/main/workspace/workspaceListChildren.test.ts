import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { listWorkspaceChildren } from '../../../src/main/workspace/workspaceListChildren.js';

describe('listWorkspaceChildren', () => {
  it('lists root children with dotfiles when enabled', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'vyotiq-list-children-'));
    await mkdir(join(tempDir, 'src'));
    await writeFile(join(tempDir, '.env'), 'x');
    await writeFile(join(tempDir, 'README.md'), '#');

    const entries = await listWorkspaceChildren(tempDir, '', true);
    expect(entries).toContain('src/');
    expect(entries).toContain('README.md');
    expect(entries).toContain('.env');
    expect(entries.find((e) => e.startsWith('src'))).toBe('src/');
  });

  it('hides dotfiles when disabled', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'vyotiq-list-children-'));
    await writeFile(join(tempDir, '.gitignore'), '*');

    const entries = await listWorkspaceChildren(tempDir, '', false);
    expect(entries).not.toContain('.gitignore');
  });

  it('skips ignored directory names', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'vyotiq-list-children-'));
    await mkdir(join(tempDir, 'node_modules'));

    const entries = await listWorkspaceChildren(tempDir, '', true);
    expect(entries.some((e) => e.includes('node_modules'))).toBe(false);
  });
});
