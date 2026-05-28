import { describe, expect, it } from 'vitest';
import {
  composeOnDiskText,
  decodeUtf8FileForEdit,
  encodeUtf8FileForWrite
} from '@shared/text/fileTextEncoding';

describe('fileTextEncoding', () => {
  it('strips UTF-8 BOM for edit matching and re-applies on write', () => {
    const decoded = decodeUtf8FileForEdit('\uFEFFhello');
    expect(decoded.body).toBe('hello');
    expect(decoded.encoding.utf8Bom).toBe(true);
    expect(composeOnDiskText('hello', decoded.encoding)).toBe('\uFEFFhello');
  });

  it('preserves CRLF line endings on write', () => {
    const decoded = decodeUtf8FileForEdit('a\r\nb');
    expect(decoded.encoding.eol).toBe('crlf');
    expect(encodeUtf8FileForWrite('a\nb', decoded.encoding)).toBe('a\r\nb');
  });
});
