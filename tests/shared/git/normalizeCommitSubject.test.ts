import { describe, expect, it } from 'vitest';
import { normalizeCommitSubject } from '@shared/git/normalizeCommitSubject';

describe('normalizeCommitSubject', () => {
  it('takes the first non-empty line and caps length', () => {
    expect(normalizeCommitSubject('feat: add tests\n\nbody')).toBe('feat: add tests');
  });

  it('returns empty for whitespace-only output', () => {
    expect(normalizeCommitSubject('  \n  ')).toBe('');
  });
});
