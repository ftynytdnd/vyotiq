import { describe, expect, it } from 'vitest';
import { isEditableTextFile } from '@shared/text/isEditableTextFile.js';

describe('isEditableTextFile', () => {
  it('accepts common source and config extensions', () => {
    expect(isEditableTextFile('src/index.ts')).toBe(true);
    expect(isEditableTextFile('README.md')).toBe(true);
    expect(isEditableTextFile('package.json')).toBe(true);
    expect(isEditableTextFile('Dockerfile')).toBe(true);
  });

  it('rejects binaries and unknown extensions', () => {
    expect(isEditableTextFile('image.png')).toBe(false);
    expect(isEditableTextFile('archive.zip')).toBe(false);
    expect(isEditableTextFile('noext')).toBe(false);
  });
});
