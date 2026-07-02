import { describe, expect, it } from 'vitest';
import { parseGitPorcelain, buildGitContextFromGitOutput, parseGitPorcelainDetailed, normalizePorcelainPath } from '../../../src/main/workspace/workspaceGitStatus.js';

describe('buildGitContextFromGitOutput', () => {
  it('returns non-repo context', () => {
    expect(
      buildGitContextFromGitOutput({
        isInsideWorkTree: 'false',
        abbrevRef: null,
        headShort: null,
        dirtyCount: 0
      })
    ).toEqual({ isRepo: false, branch: null, headShort: null, dirtyCount: 0, remote: null });
  });

  it('returns branch and dirty count for a repo', () => {
    expect(
      buildGitContextFromGitOutput({
        isInsideWorkTree: 'true',
        abbrevRef: 'main',
        headShort: 'abc1234',
        dirtyCount: 3
      })
    ).toEqual({
      isRepo: true,
      branch: 'main',
      headShort: 'abc1234',
      dirtyCount: 3,
      remote: null
    });
  });

  it('handles detached HEAD', () => {
    expect(
      buildGitContextFromGitOutput({
        isInsideWorkTree: 'true',
        abbrevRef: 'HEAD',
        headShort: 'deadbeef',
        dirtyCount: 1
      })
    ).toEqual({
      isRepo: true,
      branch: null,
      headShort: 'deadbeef',
      dirtyCount: 1,
      remote: null
    });
  });

  it('infers repo when rev-parse probe fails but dirty files exist', () => {
    expect(
      buildGitContextFromGitOutput({
        isInsideWorkTree: null,
        abbrevRef: 'main',
        headShort: 'abc1234',
        dirtyCount: 2
      })
    ).toMatchObject({
      isRepo: true,
      branch: 'main',
      dirtyCount: 2
    });
  });

  it('detects repo via .git directory when rev-parse is inconclusive', () => {
    expect(
      buildGitContextFromGitOutput({
        isInsideWorkTree: null,
        abbrevRef: null,
        headShort: null,
        dirtyCount: 0,
        hasGitDir: true
      })
    ).toMatchObject({ isRepo: true });
  });
});

describe('parseGitPorcelain', () => {
  it('maps modified, added, deleted, and untracked paths', () => {
    const stdout = [
      ' M src/main.ts',
      'A  src/new.ts',
      ' D removed.ts',
      '?? untracked.txt',
      'UU conflict.ts'
    ].join('\n');

    expect(parseGitPorcelain(stdout)).toEqual({
      'src/main.ts': 'M',
      'src/new.ts': 'A',
      'removed.ts': 'D',
      'untracked.txt': '?',
      'conflict.ts': 'U'
    });
  });

  it('uses renamed destination path', () => {
    const stdout = 'R  old.ts -> new.ts';
    expect(parseGitPorcelain(stdout)).toEqual({ 'new.ts': 'R' });
  });

  it('normalizes backslashes to forward slashes', () => {
    const stdout = ' M src\\foo.ts';
    expect(parseGitPorcelain(stdout)).toEqual({ 'src/foo.ts': 'M' });
  });

  it('unquotes paths with spaces', () => {
    const stdout = '?? "my file.txt"';
    expect(parseGitPorcelain(stdout)).toEqual({ 'my file.txt': '?' });
  });
});

describe('normalizePorcelainPath', () => {
  it('unquotes quoted paths', () => {
    expect(normalizePorcelainPath('"my file.txt"')).toBe('my file.txt');
  });

  it('uses rename destination', () => {
    expect(normalizePorcelainPath('old.ts -> new.ts')).toBe('new.ts');
  });
});

describe('parseGitPorcelainDetailed', () => {
  it('splits staged and unstaged columns', () => {
    const stdout = ['M  staged-only.ts', ' M unstaged-only.ts', 'MM both.ts', '?? untracked.ts'].join(
      '\n'
    );
    const entries = parseGitPorcelainDetailed(stdout);
    expect(entries['staged-only.ts']).toEqual({ staged: 'M' });
    expect(entries['unstaged-only.ts']).toEqual({ unstaged: 'M' });
    expect(entries['both.ts']).toEqual({ staged: 'M', unstaged: 'M' });
    expect(entries['untracked.ts']).toEqual({ unstaged: '?' });
  });
});

describe('splitGitFileStates', () => {
  it('keeps untracked files out of staged', async () => {
    const { splitGitFileStates } = await import('../../../src/main/workspace/workspaceGitStatus.js');
    const { staged, unstaged } = splitGitFileStates({
      'new.ts': { unstaged: '?' }
    });
    expect(staged).toEqual({});
    expect(unstaged).toEqual({ 'new.ts': '?' });
  });
});
