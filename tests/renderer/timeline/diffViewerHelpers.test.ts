/**
 * Pure-helper tests for the modular diff viewer:
 *   - `hunksToPatch`              — unified-diff serialisation.
 *   - `intraLineDiff`             — word-level prefix/suffix split.
 *   - `buildIntraLineMap`         — pair-wise map keyed by visible idx.
 *   - `findLastStreamingLineIdx`  — streaming-tip identification.
 *   - `buildFoldedItems`          — soft-fold sequence builder.
 */

import { describe, expect, it } from 'vitest';
import type { DiffHunk, DiffLine } from '@shared/types/tool';
import { hunksToPatch } from '@renderer/components/timeline/tools/edit/diff/hunksToPatch';
import {
  intraLineDiff,
  buildIntraLineMap,
  findLastStreamingLineIdx
} from '@renderer/components/timeline/tools/edit/diff/useIntraLineHighlight';
import { buildFoldedItems } from '@renderer/components/timeline/tools/edit/diff/softFold';

describe('hunksToPatch', () => {
  it('serialises hunks in unified-diff format', () => {
    const hunks: DiffHunk[] = [
      {
        oldStart: 1,
        newStart: 1,
        lines: [
          { kind: ' ', text: 'context' },
          { kind: '-', text: 'old' },
          { kind: '+', text: 'new' }
        ]
      },
      {
        oldStart: 10,
        newStart: 11,
        lines: [{ kind: '+', text: 'extra' }]
      }
    ];
    expect(hunksToPatch(hunks)).toBe(
      [
        '@@ -1 +1 @@',
        ' context',
        '-old',
        '+new',
        '@@ -10 +11 @@',
        '+extra'
      ].join('\n')
    );
  });

  it('returns an empty string for no hunks', () => {
    expect(hunksToPatch([])).toBe('');
  });
});

describe('intraLineDiff', () => {
  it('splits identical-prefix / identical-suffix pairs into changed spans', () => {
    const r = intraLineDiff('const x = 1;', 'const x = 2;');
    expect(r).not.toBeNull();
    expect(r!.old.prefix).toBe('const x = ');
    expect(r!.old.changed).toBe('1');
    expect(r!.old.suffix).toBe(';');
    expect(r!.new.changed).toBe('2');
  });

  it('returns null when there is NO shared prefix AND NO shared suffix', () => {
    // No shared edge characters at all → falls back to line-level
    // stain (heuristic: pre === 0 && suf === 0).
    const r = intraLineDiff('alpha', 'bravo');
    expect(r).toBeNull();
  });
});

describe('buildIntraLineMap', () => {
  it('pairs adjacent -/+ rows and skips ` ` context lines', () => {
    const lines: DiffLine[] = [
      { kind: ' ', text: 'context' },
      { kind: '-', text: 'old text here' },
      { kind: '+', text: 'new text here' },
      { kind: ' ', text: 'more context' }
    ];
    const map = buildIntraLineMap(lines);
    expect(map.has(0)).toBe(false);
    expect(map.has(1)).toBe(true);
    expect(map.has(2)).toBe(true);
    expect(map.has(3)).toBe(false);
  });

  it('skips the streaming tip pair', () => {
    const lines: DiffLine[] = [
      { kind: '-', text: 'a' },
      { kind: '+', text: 'b' }
    ];
    const withTip = buildIntraLineMap(lines, 1);
    expect(withTip.size).toBe(0);
  });
});

describe('findLastStreamingLineIdx', () => {
  it('returns the index of the last +/- line', () => {
    const lines: DiffLine[] = [
      { kind: ' ', text: 'context' },
      { kind: '+', text: 'add' },
      { kind: ' ', text: 'tail' }
    ];
    expect(findLastStreamingLineIdx(lines)).toBe(1);
  });

  it('returns -1 when the hunk has only context', () => {
    const lines: DiffLine[] = [
      { kind: ' ', text: 'a' },
      { kind: ' ', text: 'b' }
    ];
    expect(findLastStreamingLineIdx(lines)).toBe(-1);
  });
});

describe('buildFoldedItems', () => {
  it('leaves short context runs untouched', () => {
    const lines: DiffLine[] = [
      { kind: ' ', text: 'a' },
      { kind: ' ', text: 'b' },
      { kind: '+', text: 'c' }
    ];
    const items = buildFoldedItems(lines, 0, new Set());
    expect(items.every((it) => it.kind === 'line')).toBe(true);
    expect(items).toHaveLength(3);
  });

  it('folds long mid-hunk context into one placeholder', () => {
    const ctx = (n: number): DiffLine => ({ kind: ' ', text: `ctx ${n}` });
    const lines: DiffLine[] = [
      { kind: '-', text: 'old' },
      ctx(1),
      ctx(2),
      ctx(3),
      ctx(4),
      ctx(5),
      ctx(6),
      ctx(7),
      ctx(8),
      ctx(9),
      { kind: '+', text: 'new' }
    ];
    const items = buildFoldedItems(lines, 0, new Set());
    const folds = items.filter((it) => it.kind === 'fold');
    expect(folds.length).toBe(1);
    const fold = folds[0]!;
    if (fold.kind !== 'fold') throw new Error('expected fold');
    expect(fold.hidden).toBeGreaterThan(0);
  });

  it('expands a fold when its id is in the expanded set', () => {
    const ctx = (n: number): DiffLine => ({ kind: ' ', text: `ctx ${n}` });
    const lines: DiffLine[] = [
      { kind: '-', text: 'old' },
      ctx(1),
      ctx(2),
      ctx(3),
      ctx(4),
      ctx(5),
      ctx(6),
      ctx(7),
      ctx(8),
      ctx(9),
      { kind: '+', text: 'new' }
    ];
    const collapsed = buildFoldedItems(lines, 0, new Set());
    const foldEntry = collapsed.find((it) => it.kind === 'fold');
    if (!foldEntry || foldEntry.kind !== 'fold') {
      throw new Error('expected a fold in collapsed mode');
    }
    const expanded = buildFoldedItems(lines, 0, new Set([foldEntry.foldId]));
    expect(expanded.every((it) => it.kind === 'line')).toBe(true);
  });
});
