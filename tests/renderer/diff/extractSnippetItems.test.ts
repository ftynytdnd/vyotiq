import { describe, expect, it } from 'vitest';
import {
  buildSnippetItems,
  hunksToChangedSnippet
} from '@renderer/components/diff/extractSnippetItems';
import type { DiffHunk } from '@shared/types/tool';

const HUNKS: DiffHunk[] = [
  {
    oldStart: 1,
    newStart: 1,
    lines: [
      { kind: ' ', text: 'unchanged head' },
      { kind: '-', text: 'old line' },
      { kind: '+', text: 'new line' },
      { kind: ' ', text: 'unchanged tail' }
    ]
  }
];

describe('buildSnippetItems', () => {
  it('includes changed lines and one line of context', () => {
    const { items } = buildSnippetItems(HUNKS, new Set());
    const texts = items
      .filter((i) => i.kind === 'line')
      .map((i) => (i.kind === 'line' ? i.line.text : ''));
    expect(texts).toContain('old line');
    expect(texts).toContain('new line');
    expect(texts).toContain('unchanged head');
    expect(texts).toContain('unchanged tail');
  });

  it('exports changed lines for clipboard', () => {
    const text = hunksToChangedSnippet(HUNKS);
    expect(text).toContain('-old line');
    expect(text).toContain('+new line');
    expect(text).not.toContain('unchanged head');
  });

  it('folds long gaps between included regions', () => {
    const hunks: DiffHunk[] = [
      {
        oldStart: 1,
        newStart: 1,
        lines: [
          { kind: '+', text: 'first' },
          ...Array.from({ length: 8 }, (_, i) => ({ kind: ' ' as const, text: `ctx ${i}` })),
          { kind: '+', text: 'second' }
        ]
      }
    ];
    const { items } = buildSnippetItems(hunks, new Set());
    expect(items.some((i) => i.kind === 'fold')).toBe(true);
  });
});
