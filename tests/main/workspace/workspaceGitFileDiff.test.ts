import { describe, expect, it } from 'vitest';
import { computeDiffHunks } from '@shared/text/diff/computeDiffHunks.js';
import { getWorkspaceGitFileDiff } from '../../../src/main/workspace/workspaceGitFileDiff.js';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

async function initRepo(dir: string): Promise<void> {
  await exec('git', ['init'], { cwd: dir });
  await exec('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  await exec('git', ['config', 'user.name', 'Test'], { cwd: dir });
}

describe('getWorkspaceGitFileDiff', () => {
  it('diffs an untracked file against empty', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vyotiq-git-diff-'));
    await initRepo(dir);
    await writeFile(join(dir, 'new.txt'), 'hello\n', 'utf8');

    const result = await getWorkspaceGitFileDiff(dir, 'new.txt', '?');
    expect(result.binary).toBeUndefined();
    expect(result.hunks.length).toBeGreaterThan(0);
    expect(computeDiffHunks('', 'hello\n')).toEqual(result.hunks);
  });

  it('diffs a modified file against HEAD', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vyotiq-git-diff-'));
    await initRepo(dir);
    await writeFile(join(dir, 'a.txt'), 'before\n', 'utf8');
    await exec('git', ['add', 'a.txt'], { cwd: dir });
    await exec('git', ['commit', '-m', 'init'], { cwd: dir });
    await writeFile(join(dir, 'a.txt'), 'after\n', 'utf8');

    const result = await getWorkspaceGitFileDiff(dir, 'a.txt', 'M', { staged: false });
    expect(result.hunks.length).toBeGreaterThan(0);
    const joined = result.hunks.flatMap((h) => h.lines.map((l) => l.text)).join('');
    expect(joined).toContain('before');
    expect(joined).toContain('after');
  });

  it('diffs staged changes against HEAD', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vyotiq-git-diff-'));
    await initRepo(dir);
    await writeFile(join(dir, 'a.txt'), 'before\n', 'utf8');
    await exec('git', ['add', 'a.txt'], { cwd: dir });
    await exec('git', ['commit', '-m', 'init'], { cwd: dir });
    await writeFile(join(dir, 'a.txt'), 'staged\n', 'utf8');
    await exec('git', ['add', 'a.txt'], { cwd: dir });

    const result = await getWorkspaceGitFileDiff(dir, 'a.txt', 'M', { staged: true });
    expect(result.hunks.length).toBeGreaterThan(0);
    const joined = result.hunks.flatMap((h) => h.lines.map((l) => l.text)).join('');
    expect(joined).toContain('before');
    expect(joined).toContain('staged');
  });

  it('treats staged binary adds as binary', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vyotiq-git-diff-'));
    await initRepo(dir);
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    await writeFile(join(dir, 'shot.png'), pngHeader);
    await exec('git', ['add', 'shot.png'], { cwd: dir });

    const result = await getWorkspaceGitFileDiff(dir, 'shot.png', 'A', { staged: true });
    expect(result.binary).toBe(true);
    expect(result.hunks).toEqual([]);
  });

  it('diffs a deleted file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vyotiq-git-diff-'));
    await initRepo(dir);
    await writeFile(join(dir, 'gone.txt'), 'bye\n', 'utf8');
    await exec('git', ['add', 'gone.txt'], { cwd: dir });
    await exec('git', ['commit', '-m', 'init'], { cwd: dir });
    const { unlink } = await import('node:fs/promises');
    await unlink(join(dir, 'gone.txt'));

    const result = await getWorkspaceGitFileDiff(dir, 'gone.txt', 'D');
    expect(result.hunks.length).toBeGreaterThan(0);
    expect(result.hunks.some((h) => h.lines.some((l) => l.kind === '-'))).toBe(true);
  });

  it.skipIf(process.platform === 'win32')('treats symlinked files as binary', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vyotiq-git-diff-'));
    await initRepo(dir);
    await writeFile(join(dir, 'target.txt'), 'secret\n', 'utf8');
    const { symlink } = await import('node:fs/promises');
    await symlink('target.txt', join(dir, 'link.txt'));

    const result = await getWorkspaceGitFileDiff(dir, 'link.txt', '?');
    expect(result.binary).toBe(true);
    expect(result.hunks).toEqual([]);
  });
});
