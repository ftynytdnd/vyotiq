import { describe, expect, it } from 'vitest';
import { parseUnifiedPatch } from '@shared/text/diff/parseUnifiedPatch.js';
import { hunksToPatch } from '@renderer/components/timeline/tools/edit/diff/hunksToPatch.js';
import type { DiffHunk } from '@shared/types/tool.js';

describe('parseUnifiedPatch', () => {
  it('parses simplified hunks from hunksToPatch round-trip', () => {
    const source: DiffHunk[] = [
      {
        oldStart: 2,
        newStart: 2,
        lines: [
          { kind: ' ', text: 'ctx' },
          { kind: '-', text: 'old' },
          { kind: '+', text: 'new' }
        ]
      }
    ];
    const patch = hunksToPatch(source);
    const parsed = parseUnifiedPatch(patch);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.oldStart).toBe(2);
    expect(parsed[0]?.newStart).toBe(2);
    expect(parsed[0]?.lines).toEqual(source[0]!.lines);
  });

  it('parses git-style file headers and hunk counts', () => {
    const patch = [
      'diff --git a/src/foo.ts b/src/foo.ts',
      'index 111..222 100644',
      '--- a/src/foo.ts',
      '+++ b/src/foo.ts',
      '@@ -10,3 +10,4 @@',
      ' context',
      '-removed',
      '+added',
      ' tail'
    ].join('\n');
    const parsed = parseUnifiedPatch(patch);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.lines.map((l) => l.kind + l.text)).toEqual([
      ' context',
      '-removed',
      '+added',
      ' tail'
    ]);
  });
});
