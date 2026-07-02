import { describe, expect, it } from 'vitest';
import { commitMessageSubject, normalizeCommitMessage } from '@shared/git/normalizeCommitMessage';

describe('normalizeCommitMessage', () => {
  it('trims and collapses excessive blank lines', () => {
    expect(normalizeCommitMessage('  feat: add tests\n\n\n\n- detail  ')).toBe(
      'feat: add tests\n\n- detail'
    );
  });

  it('returns empty for whitespace-only output', () => {
    expect(normalizeCommitMessage('  \n  ')).toBe('');
  });
});

describe('commitMessageSubject', () => {
  it('returns the first non-empty line', () => {
    expect(commitMessageSubject('feat: add tests\n\n- body')).toBe('feat: add tests');
  });
});
