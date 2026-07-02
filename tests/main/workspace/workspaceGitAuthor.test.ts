import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { ensureGitAuthorIdentity, gitHasCommits } from '../../../src/main/workspace/workspaceGitAuthor.js';
import {
  gitCommit,
  gitStage,
  gitUnstage,
  gitUnstageAll
} from '../../../src/main/workspace/workspaceGitOps.js';
import type { WorkspaceGitRun } from '../../../src/main/workspace/workspaceGitRunner.js';
import { runGitPlain } from '../../../src/main/github/gitRunner.js';

const exec = promisify(execFile);

async function initRepo(dir: string): Promise<void> {
  await exec('git', ['init'], { cwd: dir });
}

function gitRunFor(dir: string): WorkspaceGitRun {
  return (args) => runGitPlain(['-C', dir, ...args]);
}

describe('workspaceGitAuthor integration', () => {
  it('gitHasCommits is false before first commit', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vyotiq-git-author-'));
    await initRepo(dir);
    expect(await gitHasCommits(gitRunFor(dir))).toBe(false);
  });

  it('unstage works in a repo with no commits', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vyotiq-git-author-'));
    await initRepo(dir);
    await writeFile(join(dir, 'new.txt'), 'hello\n', 'utf8');
    const gitRun = gitRunFor(dir);
    await gitStage(gitRun, ['new.txt']);
    await expect(gitUnstage(gitRun, ['new.txt'])).resolves.toBeUndefined();
    await gitStage(gitRun, ['new.txt']);
    await expect(gitUnstageAll(gitRun)).resolves.toBeUndefined();
  });

  it('ensureGitAuthorIdentity sets repo-local config and allows commit', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vyotiq-git-author-'));
    await initRepo(dir);
    await writeFile(join(dir, 'a.txt'), 'hello\n', 'utf8');
    const gitRun = gitRunFor(dir);
    await gitStage(gitRun, ['a.txt']);
    await ensureGitAuthorIdentity(gitRun);
    await gitCommit(gitRun, 'init');
    expect(await gitHasCommits(gitRun)).toBe(true);
  });
});
