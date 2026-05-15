/**
 * Shared LCS line-diff module — single source of truth for both the
 * main-process `edit` tool's authoritative `tool-result.data.hunks`
 * and the renderer-side streaming preview. Phase 1.2 extraction.
 *
 * Pin the contract on:
 *   - `computeDiffOps`: flat op list with parallel oldNums / newNums.
 *   - `computeDiffHunks`: contextual segmentation with merge logic
 *     for closely-spaced edits and clean splits for distant ones.
 *
 * Lives under tests/main so the node-environment runtime catches any
 * accidental DOM dependency the helper might pick up — the module
 * MUST stay pure so renderer, main, and worker thread can all
 * import it.
 */

import { describe, expect, it } from 'vitest';
import {
  computeDiffHunks,
  computeDiffOps,
  DEFAULT_DIFF_CONTEXT
} from '@shared/text/diff/computeDiffHunks';

describe('computeDiffOps — flat LCS walk', () => {
  it('returns an empty op list for two empty strings', () => {
    const out = computeDiffOps('', '');
    // The LCS table over `[''] × ['']` yields one ' ' op for the
    // empty line. Caller filters that case.
    expect(out.lines).toEqual([{ kind: ' ', text: '' }]);
  });

  it('emits a delete + adds when before is empty and after has content', () => {
    const out = computeDiffOps('', 'a\nb');
    // `''.split('\n')` yields `['']`; `'a\\nb'.split('\\n')` yields
    // `['a', 'b']` — no shared empty-string anchor, so the '' line
    // is a deletion and 'a'/'b' both inserted.
    expect(out.lines.map((l) => l.kind).join('')).toBe('-++');
    expect(out.lines.map((l) => l.text)).toEqual(['', 'a', 'b']);
  });

  it('emits deletes + an insert when before has content and after is empty', () => {
    const out = computeDiffOps('a\nb', '');
    // Symmetric case: 'a','b' both deleted; the trailing '' from
    // `''.split('\\n')` becomes the lone insert.
    expect(out.lines.map((l) => l.kind).join('')).toBe('--+');
  });

  it('preserves identical anchor lines as context', () => {
    const out = computeDiffOps(
      'function greet() {\n  return "helo";\n}',
      'function greet() {\n  return "hello";\n}'
    );
    expect(out.lines).toEqual([
      { kind: ' ', text: 'function greet() {' },
      { kind: '-', text: '  return "helo";' },
      { kind: '+', text: '  return "hello";' },
      { kind: ' ', text: '}' }
    ]);
  });

  it('parallels lines with 1-indexed oldNums / newNums', () => {
    const out = computeDiffOps('a\nb\nc', 'a\nB\nc');
    // a (' ') | b ('-') | B ('+') | c (' '). The number arrays
    // record the position of the NEXT-unread line on each side at
    // the moment of push (`oi` / `nj` increment AFTER the push for
    // the matching side, before the next push for the other), so
    // the trailing context line carries the post-edit position.
    expect(out.lines.map((l) => l.kind).join('')).toBe(' -+ ');
    expect(out.oldNums).toEqual([1, 2, 3, 3]);
    expect(out.newNums).toEqual([1, 2, 2, 3]);
  });

  it('handles a long unchanged span between two changes', () => {
    const before = 'a\nx\nb\nc\nd\ne\ny\nf';
    const after = 'a\nX\nb\nc\nd\ne\nY\nf';
    const out = computeDiffOps(before, after);
    // Two separate -+ pairs separated by 4 unchanged lines.
    const summary = out.lines.map((l) => l.kind).join('');
    expect(summary).toBe(' -+    -+ ');
  });
});

describe('computeDiffHunks — contextual segmentation', () => {
  it('returns one hunk per change cluster with default context', () => {
    const before = Array.from({ length: 20 }, (_, i) => `line${i}`).join('\n');
    const lines = before.split('\n');
    lines[5] = 'CHANGE_5';
    lines[15] = 'CHANGE_15';
    const after = lines.join('\n');
    const hunks = computeDiffHunks(before, after);
    // Two distinct hunks (5 and 15 are separated by ≥ 7 unchanged
    // lines, well beyond `2 * DEFAULT_DIFF_CONTEXT`).
    expect(hunks.length).toBe(2);
    const counts = hunks.map((h) => ({
      adds: h.lines.filter((l) => l.kind === '+').length,
      dels: h.lines.filter((l) => l.kind === '-').length
    }));
    expect(counts).toEqual([
      { adds: 1, dels: 1 },
      { adds: 1, dels: 1 }
    ]);
  });

  it('merges closely-spaced edits into one hunk', () => {
    const before = Array.from({ length: 10 }, (_, i) => `l${i}`).join('\n');
    const lines = before.split('\n');
    lines[3] = 'CHANGE_3';
    lines[5] = 'CHANGE_5';
    const after = lines.join('\n');
    const hunks = computeDiffHunks(before, after, DEFAULT_DIFF_CONTEXT);
    expect(hunks.length).toBe(1);
  });

  it('returns the empty array for identical inputs', () => {
    const buf = 'foo\nbar\nbaz';
    expect(computeDiffHunks(buf, buf)).toEqual([]);
  });

  it('1-indexes oldStart and newStart from the start of each side', () => {
    const before = 'a\nb\nc';
    const after = 'a\nB\nc';
    const hunks = computeDiffHunks(before, after);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.oldStart).toBe(1);
    expect(hunks[0]!.newStart).toBe(1);
  });
});
