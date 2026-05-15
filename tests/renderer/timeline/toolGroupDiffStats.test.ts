/**
 * `toolGroupDiffStats` aggregates per-row `+N -M` counts across the
 * three sources documented on the function (settled file-edit
 * merge, authoritative result without merge, and live partial
 * preview). Phase 1.2 switched the partial preview path to a real
 * LCS line diff so the badge always agrees with what the
 * synthesized preview actually shows.
 *
 * Pin the contract on:
 *   - The partial preview path counts only `+`/`-` ops (unchanged
 *     anchor lines are NOT counted, fixing the pre-1.2 bug where
 *     typo-sized edits inflated the badge to the full line count
 *     of `oldString` + `newString`).
 *   - Mixed sources (one settled child, one partial child) sum
 *     correctly without double-counting.
 */

import { describe, expect, it } from 'vitest';
import { toolGroupDiffStats } from '@renderer/components/timeline/reducer/deriveRows';
import type { ToolCall, ToolResult } from '@shared/types/tool';

describe('toolGroupDiffStats — live partial preview source', () => {
  it('counts only +/- ops, not unchanged anchor lines', () => {
    // 3-line `oldString` / `newString` where 2 lines are anchor
    // context. Pre-1.2 reported `+3 -3`; post-1.2 reports `+1 -1`.
    const child = {
      callId: 'c1',
      partial: true,
      call: {
        id: 'c1',
        name: 'edit',
        args: {
          path: 'src/foo.ts',
          oldString: 'function greet() {\n  return "helo";\n}',
          newString: 'function greet() {\n  return "hello";\n}'
        }
      } as ToolCall
    };
    const stats = toolGroupDiffStats([child]);
    expect(stats).toEqual({ additions: 1, deletions: 1 });
  });

  it('returns zeros when both strings are empty / missing', () => {
    const child = {
      callId: 'c1',
      partial: true,
      call: {
        id: 'c1',
        name: 'edit',
        args: { path: 'src/foo.ts' }
      } as ToolCall
    };
    expect(toolGroupDiffStats([child])).toEqual({ additions: 0, deletions: 0 });
  });

  it('counts every line of `content` for a partial create call', () => {
    const child = {
      callId: 'c1',
      partial: true,
      call: {
        id: 'c1',
        name: 'edit',
        args: {
          path: 'src/new.ts',
          create: true,
          content: 'line1\nline2\nline3'
        }
      } as ToolCall
    };
    expect(toolGroupDiffStats([child])).toEqual({ additions: 3, deletions: 0 });
  });

  it('sums settled + partial children without double-counting', () => {
    const settled = {
      callId: 'c0',
      fileEditAdditions: 5,
      fileEditDeletions: 2,
      call: { id: 'c0', name: 'edit', args: { path: 'a.ts' } } as ToolCall,
      result: {
        id: 'c0',
        name: 'edit',
        ok: true,
        output: 'Edited a.ts (+5 -2)',
        durationMs: 0,
        data: {
          tool: 'edit',
          filePath: 'a.ts',
          additions: 5,
          deletions: 2,
          created: false,
          hunks: []
        }
      } as ToolResult
    };
    const partial = {
      callId: 'c1',
      partial: true,
      call: {
        id: 'c1',
        name: 'edit',
        args: {
          path: 'b.ts',
          oldString: 'console.log("a");',
          newString: 'console.log("b");'
        }
      } as ToolCall
    };
    expect(toolGroupDiffStats([settled, partial])).toEqual({
      additions: 6,
      deletions: 3
    });
  });

  it('prefers an authoritative result over the partial preview when both populate', () => {
    // Defensive: a child with both `result` and `partial: true`
    // should never happen in practice (the reducer clears partial
    // entries on `tool-call`), but the function's path ordering
    // matters for that race-window correctness.
    const child = {
      callId: 'c1',
      partial: true,
      call: {
        id: 'c1',
        name: 'edit',
        args: {
          path: 'a.ts',
          oldString: '1\n2\n3\n4',
          newString: 'X\nY\nZ\nW'
        }
      } as ToolCall,
      result: {
        id: 'c1',
        name: 'edit',
        ok: true,
        output: 'Edited a.ts (+1 -1)',
        durationMs: 0,
        data: {
          tool: 'edit',
          filePath: 'a.ts',
          additions: 1,
          deletions: 1,
          created: false,
          hunks: []
        }
      } as ToolResult
    };
    // `+1 -1` from the result, NOT the `+4 -4` the partial preview
    // would yield from the args.
    expect(toolGroupDiffStats([child])).toEqual({ additions: 1, deletions: 1 });
  });
});
