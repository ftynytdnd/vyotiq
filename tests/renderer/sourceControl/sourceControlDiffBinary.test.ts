import { describe, expect, it } from 'vitest';
import { looksLikeBinaryHunks } from '@renderer/components/sourceControl/sourceControlDiffBinary.js';
import type { DiffHunk } from '@shared/types/tool.js';

describe('looksLikeBinaryHunks', () => {
  it('detects replacement-character garbage', () => {
    const hunks: DiffHunk[] = [
      {
        header: '@@',
        lines: [{ kind: '+', text: '\uFFFD\uFFFD\uFFFD\uFFFD'.repeat(40), oldNo: null, newNo: 1 }]
      }
    ];
    expect(looksLikeBinaryHunks(hunks)).toBe(true);
  });

  it('returns false for normal text diffs', () => {
    const hunks: DiffHunk[] = [
      {
        header: '@@',
        lines: [{ kind: '+', text: 'export function hello() {\n', oldNo: null, newNo: 1 }]
      }
    ];
    expect(looksLikeBinaryHunks(hunks)).toBe(false);
  });
});
