/**
 * `formatTokenCount` / `parseTokenCount` round-trip and edge-case
 * coverage. These helpers feed both the usage pill and the model-row
 * context-window editor, so ambiguity here reads as a user-visible bug.
 */

import { describe, expect, it } from 'vitest';
import { formatTokenCount, parseTokenCount } from '@renderer/lib/formatTokens';

describe('formatTokenCount', () => {
  it('renders integers below 1000 verbatim', () => {
    expect(formatTokenCount(0)).toBe('0');
    expect(formatTokenCount(999)).toBe('999');
  });

  it('renders thousands with a `k` suffix', () => {
    expect(formatTokenCount(1_000)).toBe('1k');
    expect(formatTokenCount(128_000)).toBe('128k');
    expect(formatTokenCount(1_500)).toBe('1.5k');
  });

  it('renders millions with an `M` suffix', () => {
    expect(formatTokenCount(1_000_000)).toBe('1M');
    expect(formatTokenCount(2_500_000)).toBe('2.5M');
  });

  it('returns an em-dash for negative / NaN inputs', () => {
    expect(formatTokenCount(-1)).toBe('—');
    expect(formatTokenCount(Number.NaN)).toBe('—');
  });
});

describe('parseTokenCount', () => {
  it('parses plain integers', () => {
    expect(parseTokenCount('1024')).toBe(1024);
    expect(parseTokenCount('  128000  ')).toBe(128_000);
  });

  it('parses `k` / `K` suffix (case-insensitive)', () => {
    expect(parseTokenCount('128k')).toBe(128_000);
    expect(parseTokenCount('1.5k')).toBe(1_500);
    expect(parseTokenCount('64K')).toBe(64_000);
  });

  it('parses `m` / `M` suffix', () => {
    expect(parseTokenCount('1m')).toBe(1_000_000);
    expect(parseTokenCount('1.5M')).toBe(1_500_000);
  });

  it('ignores underscores, commas, and internal whitespace', () => {
    expect(parseTokenCount('128_000')).toBe(128_000);
    expect(parseTokenCount('128,000')).toBe(128_000);
    expect(parseTokenCount('1 000 000')).toBe(1_000_000);
  });

  it('returns null for garbage input', () => {
    expect(parseTokenCount('')).toBeNull();
    expect(parseTokenCount('abc')).toBeNull();
    expect(parseTokenCount('1g')).toBeNull();
    expect(parseTokenCount('-5')).toBeNull();
    expect(parseTokenCount('0')).toBeNull();
  });
});
