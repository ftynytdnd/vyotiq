import { describe, expect, it } from 'vitest';
import { validateGitRef } from '../../../src/main/checkpoints/gitBaseDiff.js';

describe('validateGitRef', () => {
  it('accepts common refs', () => {
    expect(validateGitRef('HEAD')).toBe('HEAD');
    expect(validateGitRef('main')).toBe('main');
    expect(validateGitRef('origin/main')).toBe('origin/main');
    expect(validateGitRef('@{u}')).toBe('@{u}');
  });

  it('rejects injection-ish refs', () => {
    expect(validateGitRef('HEAD; rm -rf /')).toBeNull();
    expect(validateGitRef('../../../etc/passwd')).toBeNull();
    expect(validateGitRef('-flag')).toBeNull();
    expect(validateGitRef('')).toBeNull();
  });
});
