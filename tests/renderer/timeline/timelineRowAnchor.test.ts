import { describe, expect, it } from 'vitest';
import {
  parseRowAnchorHash,
  rowAnchorDomId,
  rowAnchorHash
} from '@renderer/components/timeline/shared/timelineRowAnchor';

describe('timelineRowAnchor', () => {
  it('round-trips row keys through hash helpers', () => {
    const key = 'text:abc-123';
    expect(rowAnchorDomId(key)).toBe(`row-${encodeURIComponent(key)}`);
    expect(rowAnchorHash(key)).toBe(`#row-${encodeURIComponent(key)}`);
    expect(parseRowAnchorHash(rowAnchorHash(key))).toBe(key);
  });
});
