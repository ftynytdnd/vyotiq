import { describe, expect, it } from 'vitest';
import {
  formatBranchChipLabel,
  formatBranchSyncSuffix
} from '../../../src/shared/github/formatBranchSync.js';
import { buildGitContextFromGitOutput } from '../../../src/main/workspace/workspaceGitStatus.js';

describe('formatBranchSync', () => {
  it('formats ahead and behind suffixes', () => {
    expect(formatBranchSyncSuffix(2, 1)).toBe(' ↑2 ↓1');
    expect(formatBranchSyncSuffix(0, 3)).toBe(' ↓3');
    expect(formatBranchSyncSuffix(undefined, undefined)).toBe('');
  });

  it('builds branch chip label', () => {
    expect(formatBranchChipLabel('main', 2, 0)).toBe('main ↑2');
    expect(formatBranchChipLabel('dev', 0, 1)).toBe('dev ↓1');
  });
});

describe('buildGitContextFromGitOutput ahead/behind', () => {
  it('includes sync counts when present', () => {
    const ctx = buildGitContextFromGitOutput({
      isInsideWorkTree: 'true',
      abbrevRef: 'main',
      headShort: 'abc1234',
      dirtyCount: 0,
      ahead: 2,
      behind: 1
    });
    expect(ctx.ahead).toBe(2);
    expect(ctx.behind).toBe(1);
  });

  it('omits zero sync counts', () => {
    const ctx = buildGitContextFromGitOutput({
      isInsideWorkTree: 'true',
      abbrevRef: 'main',
      headShort: 'abc1234',
      dirtyCount: 0,
      ahead: 0,
      behind: 0
    });
    expect(ctx.ahead).toBeUndefined();
    expect(ctx.behind).toBeUndefined();
  });
});
