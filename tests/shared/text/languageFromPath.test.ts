import { describe, expect, it } from 'vitest';
import { basenameFromPath, languageFromPath } from '@shared/text/languageFromPath';

describe('languageFromPath', () => {
  it('maps common extensions', () => {
    expect(languageFromPath('src/app.tsx')).toBe('typescript');
    expect(languageFromPath('lib/utils.py')).toBe('python');
    expect(languageFromPath('package.json')).toBe('json');
  });

  it('returns undefined for extensionless paths', () => {
    expect(languageFromPath('Makefile')).toBeUndefined();
  });
});

describe('basenameFromPath', () => {
  it('returns the final segment', () => {
    expect(basenameFromPath('src/components/App.tsx')).toBe('App.tsx');
    expect(basenameFromPath('App.tsx')).toBe('App.tsx');
  });
});
