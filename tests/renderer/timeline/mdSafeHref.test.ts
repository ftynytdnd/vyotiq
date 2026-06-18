import { describe, expect, it } from 'vitest';
import { mdSafeHref } from '@renderer/components/timeline/markdown/mdSafeHref.js';

describe('mdSafeHref', () => {
  it('allows http and https URLs', () => {
    expect(mdSafeHref('https://example.com')).toBe('https://example.com');
    expect(mdSafeHref('http://example.com/path')).toBe('http://example.com/path');
  });

  it('allows mailto and relative paths', () => {
    expect(mdSafeHref('mailto:hi@example.com')).toBe('mailto:hi@example.com');
    expect(mdSafeHref('#section')).toBe('#section');
    expect(mdSafeHref('/docs/readme')).toBe('/docs/readme');
    expect(mdSafeHref('./local.md')).toBe('./local.md');
  });

  it('rejects javascript, vbscript, and data URLs', () => {
    expect(mdSafeHref('javascript:alert(1)')).toBeUndefined();
    expect(mdSafeHref('vbscript:msgbox(1)')).toBeUndefined();
    expect(mdSafeHref('data:text/html,<script>alert(1)</script>')).toBeUndefined();
  });

  it('rejects control characters smuggled into hrefs', () => {
    expect(mdSafeHref('https://example.com/\u0000.evil')).toBeUndefined();
  });
});
