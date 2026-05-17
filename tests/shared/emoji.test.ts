import { describe, expect, it } from 'vitest';
import { stripEmoji } from '@shared/text/emoji';

describe('stripEmoji', () => {
  it('removes emoji from model-authored display text without changing words', () => {
    expect(stripEmoji('\u{1F9E0} Rust Backend \u{1F680}')).toBe('Rust Backend');
  });

  it('removes joined emoji sequences', () => {
    expect(stripEmoji('Built by \u{1F468}\u200D\u{1F4BB} agent')).toBe('Built by agent');
  });
});
