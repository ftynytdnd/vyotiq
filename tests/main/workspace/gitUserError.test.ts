import { describe, expect, it } from 'vitest';
import {
  assertGitRemote,
  GitUserError,
  isGitUserError,
  rethrowGitSyncError
} from '../../../src/main/workspace/gitUserError.js';

describe('gitUserError', () => {
  it('assertGitRemote throws GitUserError when null', () => {
    expect(() => assertGitRemote(null)).toThrow(GitUserError);
    expect(() => assertGitRemote(null)).toThrow(/No git remote configured/);
  });

  it('rethrowGitSyncError maps non-repo message', () => {
    expect(() =>
      rethrowGitSyncError(new Error("fatal: 'x' does not appear to be a git repository"))
    ).toThrow(/not a git repository/);
  });

  it('rethrowGitSyncError preserves GitUserError', () => {
    const err = new GitUserError('already user-facing');
    expect(() => rethrowGitSyncError(err)).toThrow(err);
  });

  it('rethrowGitSyncError maps missing author identity', () => {
    expect(() =>
      rethrowGitSyncError(
        new Error(
          "Author identity unknown\n\nfatal: unable to auto-detect email address (got 'admin@DESKTOP.(none)')"
        )
      )
    ).toThrow(/user\.name/);
  });

  it('isGitUserError identifies instances', () => {
    expect(isGitUserError(new GitUserError('x'))).toBe(true);
    expect(isGitUserError(new Error('x'))).toBe(false);
  });
});
