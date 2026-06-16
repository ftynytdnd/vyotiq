import { describe, expect, it } from 'vitest';
import { normalizeEditorBufferText } from '../../../src/shared/text/normalizeEditorBuffer.js';

describe('normalizeEditorBufferText', () => {
  it('converts CRLF and lone CR to LF', () => {
    expect(normalizeEditorBufferText('a\r\nb\rc')).toBe('a\nb\nc');
  });

  it('leaves LF-only text unchanged', () => {
    expect(normalizeEditorBufferText('a\nb')).toBe('a\nb');
  });
});
