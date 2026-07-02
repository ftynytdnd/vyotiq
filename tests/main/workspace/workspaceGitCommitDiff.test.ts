import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildCommitChangeAnalysis,
  buildCommitDiffContext,
  buildCommitDiffExcerpt,
  buildCommitChangeSummary,
  buildCommitHistorySamples,
  listCommitRelevantPaths
} from '../../../src/main/workspace/workspaceGitCommitDiff.js';

describe('buildCommitDiffExcerpt', () => {
  it('returns staged diff when present', async () => {
    const gitRun = vi.fn(async (args: string[]) => {
      if (args[0] === 'status') return 'A  a.ts';
      if (args[0] === 'diff' && args[1] === '--cached' && args[2] === '--stat') return '1 file changed';
      if (args[0] === 'diff' && args[1] === '--cached') return 'diff --git a/a.ts b/a.ts';
      if (args[0] === 'diff') return '';
      return '';
    });
    const excerpt = await buildCommitDiffExcerpt(gitRun, '/tmp/ws');
    expect(excerpt).toContain('diff --git a/a.ts b/a.ts');
    expect(excerpt).toContain('Staged diff stat');
  });

  it('falls back to unstaged diff', async () => {
    const gitRun = vi.fn(async (args: string[]) => {
      if (args[0] === 'status') return ' M b.ts';
      if (args[0] === 'diff' && args[1] === '--cached') return '';
      if (args[0] === 'diff' && args[2] === '--stat') return '1 file changed';
      if (args[0] === 'diff') return 'diff --git a/b.ts b/b.ts';
      return '';
    });
    const excerpt = await buildCommitDiffExcerpt(gitRun, '/tmp/ws');
    expect(excerpt).toContain('diff --git a/b.ts b/b.ts');
  });

  it('summarizes untracked files when git diff is empty', async () => {
    const wsPath = await mkdtemp(join(tmpdir(), 'vyotiq-git-diff-'));
    await mkdir(join(wsPath, 'src'), { recursive: true });
    await writeFile(join(wsPath, 'src', 'new.ts'), 'export const x = 1;\n', 'utf8');

    const gitRun = vi.fn(async (args: string[]) => {
      if (args[0] === 'diff') return '';
      if (args[0] === 'status') return '?? src/new.ts';
      throw new Error(`unexpected: ${args.join(' ')}`);
    });

    const excerpt = await buildCommitDiffExcerpt(gitRun, wsPath);
    expect(excerpt).toContain('+++ b/src/new.ts');
    expect(excerpt).toContain('export const x = 1;');
  });

  it('lists binary untracked paths without content', async () => {
    const wsPath = await mkdtemp(join(tmpdir(), 'vyotiq-git-diff-'));
    await writeFile(join(wsPath, 'image.png'), Buffer.from([0, 1, 2, 3]), undefined);

    const gitRun = vi.fn(async (args: string[]) => {
      if (args[0] === 'diff') return '';
      if (args[0] === 'status') return '?? image.png';
      throw new Error(`unexpected: ${args.join(' ')}`);
    });

    const excerpt = await buildCommitDiffExcerpt(gitRun, wsPath);
    expect(excerpt).toBe('new file: image.png');
  });
});

describe('buildCommitDiffContext', () => {
  it('marks oversized truncated diffs', async () => {
    const huge = 'diff --git a/a.ts b/a.ts\n' + '+line\n'.repeat(20_000);
    const gitRun = vi.fn(async (args: string[]) => {
      if (args[0] === 'status') return 'M  a.ts';
      if (args[0] === 'diff' && args[1] === '--cached') return '';
      if (args[0] === 'diff' && args[2] === '--stat') return '1 file changed';
      if (args[0] === 'diff') return huge;
      return '';
    });
    const ctx = await buildCommitDiffContext(gitRun, '/tmp/ws');
    expect(ctx).not.toBeNull();
    expect(ctx!.truncated).toBe(true);
    expect(ctx!.excerpt).toContain('truncated');
  });
});

describe('buildCommitHistorySamples', () => {
  it('returns recent log text', async () => {
    const gitRun = vi.fn(async () => 'feat: test\n\nbody\n---');
    expect(await buildCommitHistorySamples(gitRun)).toContain('feat: test');
  });
});

describe('listCommitRelevantPaths', () => {
  it('prefers staged paths when staged diff exists', async () => {
    const gitRun = vi.fn(async (args: string[]) => {
      if (args[0] === 'status') return 'A  staged.ts\n M unstaged.ts';
      if (args[0] === 'diff' && args[1] === '--cached') return 'diff --git a/staged.ts';
      return '';
    });
    const relevant = await listCommitRelevantPaths(gitRun);
    expect(relevant?.staged).toBe(true);
    expect(relevant?.paths).toEqual(['staged.ts']);
  });
});

describe('buildCommitChangeAnalysis', () => {
  it('detects initial import pattern and scope', async () => {
    const lines = Array.from({ length: 10 }, (_, i) => `A  landing/src/f${i}.ts`).join('\n');
    const gitRun = vi.fn(async () => lines);
    const analysis = await buildCommitChangeAnalysis(gitRun);
    expect(analysis).not.toBeNull();
    expect(analysis!.likelyInitialImport).toBe(true);
    expect(analysis!.primaryScope).toBe('landing');
    expect(analysis!.allAdded).toBe(true);
  });
});

describe('buildCommitChangeSummary', () => {
  it('returns structured analysis and paths', async () => {
    const gitRun = vi.fn(async () => 'A  src/a.ts\n?? src/b.ts');
    const summary = await buildCommitChangeSummary(gitRun);
    expect(summary).toContain('Total changed paths: 2');
    expect(summary).toContain('src/a.ts');
    expect(summary).toContain('src/b.ts');
  });

  it('returns empty string when status fails', async () => {
    const gitRun = vi.fn(async () => {
      throw new Error('not a repo');
    });
    expect(await buildCommitChangeSummary(gitRun)).toBe('');
  });
});
