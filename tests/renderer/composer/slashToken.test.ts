import { describe, expect, it } from 'vitest';
import { detectSlashToken } from '@renderer/components/composer/slashToken';

describe('detectSlashToken', () => {
  it('detects slash at start', () => {
    expect(detectSlashToken('/deploy', 7)).toEqual({ start: 0, query: 'deploy' });
  });

  it('detects slash after whitespace', () => {
    expect(detectSlashToken('please /skill rest', 13)).toEqual({ start: 7, query: 'skill' });
  });

  it('returns null inside path-like text', () => {
    expect(detectSlashToken('src/foo/bar', 11)).toBeNull();
  });

  it('returns null for @ mention context', () => {
    expect(detectSlashToken('@file.ts', 8)).toBeNull();
  });
});
