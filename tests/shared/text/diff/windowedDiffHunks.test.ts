import { describe, expect, it } from 'vitest';
import {
  computeDiffHunksBounded,
  extractDiffWindow,
  offsetDiffHunks
} from '@shared/text/diff/windowedDiffHunks.js';

describe('windowedDiffHunks', () => {
  it('returns full diff for small bodies', () => {
    const window = extractDiffWindow('a\nb\nc', 'a\nx\nc');
    expect(window.oldLineOffset).toBe(0);
    expect(window.before).toBe('a\nb\nc');
  });

  it('windows around the changed region for large bodies', () => {
    const prefix = 'line\n'.repeat(110_000);
    const before = `${prefix}old\n${'tail\n'.repeat(110_000)}`;
    const after = `${prefix}new\n${'tail\n'.repeat(110_000)}`;
    const window = extractDiffWindow(before, after);
    expect(window.before.length + window.after.length).toBeLessThan(before.length + after.length);
    expect(window.oldLineOffset).toBeGreaterThan(0);
  });

  it('offsets hunk line numbers for windowed slices', () => {
    const hunks = offsetDiffHunks(
      [{ oldStart: 1, newStart: 1, lines: [{ kind: '+', text: 'x' }] }],
      10,
      10
    );
    expect(hunks[0]!.oldStart).toBe(11);
    expect(hunks[0]!.newStart).toBe(11);
  });

  it('computeDiffHunksBounded produces hunks for a small edit', () => {
    const hunks = computeDiffHunksBounded('a\nold\nb', 'a\nnew\nb');
    const text = hunks.flatMap((h) => h.lines.map((l) => l.text)).join(',');
    expect(text).toContain('old');
    expect(text).toContain('new');
  });
});
