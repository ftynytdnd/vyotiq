import { describe, expect, it } from 'vitest';
import {
  isClipboardHttpUrl,
  parseClipboardHttpUrl,
  urlAttachmentLabel
} from '@shared/attachments/clipboardUrl.js';

describe('clipboardUrl', () => {
  it('detects http(s) URLs', () => {
    expect(isClipboardHttpUrl('https://example.com/docs')).toBe(true);
    expect(isClipboardHttpUrl('http://localhost:3000')).toBe(true);
    expect(isClipboardHttpUrl('not a url')).toBe(false);
    expect(isClipboardHttpUrl('https://a.com\nhttps://b.com')).toBe(false);
  });

  it('parses and normalizes URLs', () => {
    expect(parseClipboardHttpUrl('https://example.com/path')).toBe('https://example.com/path');
    expect(parseClipboardHttpUrl('ftp://x.com')).toBeNull();
  });

  it('labels URL attachments by hostname', () => {
    expect(urlAttachmentLabel('https://docs.vyotiq.dev/guide')).toBe('docs.vyotiq.dev');
  });
});
