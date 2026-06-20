/**
 * formatRelativeTime — compact dock session timestamps.
 */

import { describe, expect, it } from 'vitest';
import { formatRelativeTime } from '@renderer/lib/formatRelativeTime';

describe('formatRelativeTime', () => {
  const now = Date.parse('2026-06-19T12:00:00.000Z');

  it('formats sub-minute as now', () => {
    expect(formatRelativeTime(now - 30_000, now)).toBe('now');
  });

  it('formats minutes and hours', () => {
    expect(formatRelativeTime(now - 4 * 60_000, now)).toBe('4m');
    expect(formatRelativeTime(now - 9 * 60 * 60_000, now)).toBe('9h');
  });

  it('formats days', () => {
    expect(formatRelativeTime(now - 3 * 24 * 60 * 60_000, now)).toBe('3d');
  });
});
