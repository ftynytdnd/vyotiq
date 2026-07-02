import { describe, expect, it } from 'vitest';
import { formatLandingGitContextLine } from '@shared/git/formatLandingGitContext';

describe('formatLandingGitContextLine', () => {
  it('formats branch with dirty count', () => {
    expect(
      formatLandingGitContextLine('vyotiq', {
        isRepo: true,
        branch: 'main',
        headShort: 'abc',
        dirtyCount: 3
      })
    ).toBe('vyotiq · main · 3 changes');
  });

  it('includes ahead and behind on branch ref', () => {
    expect(
      formatLandingGitContextLine('vyotiq', {
        isRepo: true,
        branch: 'main',
        headShort: 'abc',
        dirtyCount: 0,
        ahead: 2,
        behind: 1
      })
    ).toBe('vyotiq · main ↑2 ↓1');
  });

  it('formats non-repo workspace', () => {
    expect(
      formatLandingGitContextLine('vyotiq', {
        isRepo: false,
        branch: null,
        headShort: null,
        dirtyCount: 0
      })
    ).toBe('vyotiq · not a git repository');
  });
});
