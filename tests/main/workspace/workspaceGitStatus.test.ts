import { describe, expect, it } from 'vitest';
import { parseGitPorcelain } from '../../../src/main/workspace/workspaceGitStatus.js';

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
});
