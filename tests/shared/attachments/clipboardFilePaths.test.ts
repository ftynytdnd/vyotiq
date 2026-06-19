import { describe, expect, it } from 'vitest';
import {
  looksLikeAbsoluteFilePath,
  normalizeClipboardPath,
  parseFileUriList
} from '@shared/attachments/clipboardFilePaths.js';

describe('clipboardFilePaths', () => {
  it('detects Windows absolute paths', () => {
    expect(looksLikeAbsoluteFilePath('C:\\Users\\me\\shot.png')).toBe(true);
    expect(looksLikeAbsoluteFilePath('hello')).toBe(false);
  });

  it('parses file URI lists', () => {
    expect(
      parseFileUriList('file:///C:/Users/me/shot.png\r\n# ignore')
    ).toEqual(['C:/Users/me/shot.png']);
  });

  it('normalizes file URIs on Windows', () => {
    expect(normalizeClipboardPath('file:///C:/Users/me/shot.png')).toBe(
      'C:/Users/me/shot.png'
    );
  });
});
