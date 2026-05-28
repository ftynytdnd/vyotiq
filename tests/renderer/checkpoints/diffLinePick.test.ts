import { describe, expect, it } from 'vitest';
import { pickAnchorLine } from '@renderer/components/timeline/tools/edit/diff/diffLinePick.js';

describe('pickAnchorLine', () => {
  it('prefers new line over old', () => {
    expect(pickAnchorLine({ newLine: 12, oldLine: 5 })).toBe(12);
  });

  it('falls back to old line for deletions', () => {
    expect(pickAnchorLine({ newLine: null, oldLine: 7 })).toBe(7);
  });

  it('returns null when no gutter numbers', () => {
    expect(pickAnchorLine({ newLine: null, oldLine: null })).toBeNull();
  });
});
