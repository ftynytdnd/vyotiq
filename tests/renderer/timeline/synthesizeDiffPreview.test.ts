/**
 * Pure-function tests for `synthesizeDiffPreview` — the helper that
 * converts an `edit` tool call's already-parsed arguments into a
 * predictive diff structure that can be rendered BEFORE the tool
 * actually runs.
 *
 * Contract under test (Phase 1.2 upgrade — real LCS):
 *   - Total (never throws). Pathological inputs return `null`.
 *   - `edit` mode (oldString + newString) runs through the shared
 *     `computeDiffHunks` so unchanged lines are preserved as ` `
 *     context, edits collapse into structured `-`/`+` lines, and
 *     closely-spaced edits land in one hunk. The first hunk's
 *     `oldStart` / `newStart` are `1` because no real file context
 *     exists yet — the authoritative `tool-result` later overwrites
 *     these with disk-relative positions.
 *   - `create` mode emits a `create-preview` carrying the full
 *     content the model is about to write.
 *   - `replaceAll: true` surfaces the "all occurrences" marker so the
 *     renderer can label the pane honestly.
 */

import { describe, expect, it } from 'vitest';
import { synthesizeDiffPreview } from '@renderer/components/timeline/tools/edit/synthesizeDiffPreview';

describe('synthesizeDiffPreview', () => {
  it('builds one synthetic hunk for an edit with both old + new strings', () => {
    const out = synthesizeDiffPreview({
      path: 'src/foo.ts',
      oldString: 'a\nb',
      newString: 'c'
    });
    expect(out).not.toBeNull();
    if (out?.kind !== 'edit-preview') throw new Error('expected edit-preview');
    expect(out.hunks).toHaveLength(1);
    const hunk = out.hunks[0]!;
    expect(hunk.oldStart).toBe(1);
    expect(hunk.newStart).toBe(1);
    // Real LCS for ('a','b') -> ('c'): 'a' and 'b' both delete, 'c'
    // adds. No common subsequence, so no context lines.
    expect(hunk.lines).toEqual([
      { kind: '-', text: 'a' },
      { kind: '-', text: 'b' },
      { kind: '+', text: 'c' }
    ]);
    // replaceAll defaults to false → marker absent.
    expect(out.replaceAll).toBe(false);
  });

  it('preserves unchanged anchor lines as context (LCS, not all-red-all-green)', () => {
    // The dominant case for streaming edits: a short typo fix where
    // most lines are anchor context. The pre-1.2 implementation
    // dropped every unchanged line, producing a wall of red+green.
    // The 1.2 implementation runs the strings through the real LCS
    // walker so unchanged lines render as ' ' context.
    const out = synthesizeDiffPreview({
      path: 'src/foo.ts',
      oldString: 'function greet() {\n  return "helo";\n}',
      newString: 'function greet() {\n  return "hello";\n}'
    });
    if (out?.kind !== 'edit-preview') throw new Error('expected edit-preview');
    expect(out.hunks).toHaveLength(1);
    const hunk = out.hunks[0]!;
    // Anchor lines are present as context, not duplicated as -/+ pairs.
    expect(hunk.lines).toEqual([
      { kind: ' ', text: 'function greet() {' },
      { kind: '-', text: '  return "helo";' },
      { kind: '+', text: '  return "hello";' },
      { kind: ' ', text: '}' }
    ]);
  });

  it('surfaces replaceAll as a marker', () => {
    const out = synthesizeDiffPreview({
      path: 'src/foo.ts',
      oldString: 'x',
      newString: 'y',
      replaceAll: true
    });
    expect(out).not.toBeNull();
    if (out?.kind !== 'edit-preview') throw new Error('expected edit-preview');
    expect(out.replaceAll).toBe(true);
  });

  it('handles a create call by returning the full pending content plus all-`+` hunks', () => {
    // Bug A+B regression — pre-fix the `create-preview` carried only
    // a `content` string, which `EditInvocation` then dumped through
    // `CodeBlock tone="muted"` (plain text wall, no green tint, no
    // streaming cursor). The fix added a `hunks` field where every
    // line of `content` lands as a `+` line so the renderer can
    // route it through the shared `EditDiffView` like a modify
    // diff. This test pins the new contract.
    const out = synthesizeDiffPreview({
      path: 'src/new.ts',
      create: true,
      content: 'console.log(1);\nconsole.log(2);'
    });
    expect(out).not.toBeNull();
    if (out?.kind !== 'create-preview') throw new Error('expected create-preview');
    expect(out.content).toBe('console.log(1);\nconsole.log(2);');
    expect(out.hunks).toHaveLength(1);
    const hunk = out.hunks[0]!;
    expect(hunk.oldStart).toBe(1);
    expect(hunk.newStart).toBe(1);
    expect(hunk.lines).toEqual([
      { kind: '+', text: 'console.log(1);' },
      { kind: '+', text: 'console.log(2);' }
    ]);
    // No `-` or context lines — a fresh file is structurally
    // "everything added".
    expect(hunk.lines.every((l) => l.kind === '+')).toBe(true);
  });

  it('preserves a trailing newline in the create hunks as an empty `+` line', () => {
    // Mirrors `computeDiffOps`'s `split('\n')` shape so the
    // preview → authoritative settle is byte-identical at the
    // line level — important so the settle animation doesn't
    // restructure the line list mid-flight.
    const out = synthesizeDiffPreview({
      path: 'src/new.ts',
      create: true,
      content: 'one\ntwo\n'
    });
    if (out?.kind !== 'create-preview') throw new Error('expected create-preview');
    expect(out.hunks[0]!.lines).toEqual([
      { kind: '+', text: 'one' },
      { kind: '+', text: 'two' },
      { kind: '+', text: '' }
    ]);
  });

  it('returns null when neither edit-form nor create-form args are present', () => {
    expect(synthesizeDiffPreview({ path: 'src/foo.ts' })).toBeNull();
    // create:true but no content → also null (the renderer falls back
    // to the existing "no detail yet" path).
    expect(
      synthesizeDiffPreview({ path: 'src/foo.ts', create: true })
    ).toBeNull();
    // edit args with only one of the two strings → null.
    expect(
      synthesizeDiffPreview({ path: 'src/foo.ts', oldString: 'x' })
    ).toBeNull();
    expect(
      synthesizeDiffPreview({ path: 'src/foo.ts', newString: 'y' })
    ).toBeNull();
  });

  it('handles a no-op edit (oldString === newString) by returning null', () => {
    // The tool itself rejects this with a `no-op` error, and the preview
    // surface should refuse to show a diff where every line is both
    // added and removed — the user would otherwise see noise.
    expect(
      synthesizeDiffPreview({
        path: 'src/foo.ts',
        oldString: 'same',
        newString: 'same'
      })
    ).toBeNull();
  });

  it('survives garbage / wrong-shape input without throwing', () => {
    // Numeric path, missing path, object where string expected, ...
    expect(synthesizeDiffPreview({})).toBeNull();
    expect(
      synthesizeDiffPreview({ path: 42 as unknown as string })
    ).toBeNull();
    expect(
      synthesizeDiffPreview({
        path: 'src/foo.ts',
        oldString: 1 as unknown as string,
        newString: 'y'
      })
    ).toBeNull();
    expect(
      synthesizeDiffPreview({
        path: 'src/foo.ts',
        create: true,
        content: { not: 'a string' } as unknown as string
      })
    ).toBeNull();
  });

  it('preserves blank lines inside the oldString / newString bodies', () => {
    const out = synthesizeDiffPreview({
      path: 'a.ts',
      oldString: 'one\n\nthree',
      newString: 'ONE\n\nTHREE'
    });
    if (out?.kind !== 'edit-preview') throw new Error('expected edit-preview');
    // The blank line at index 1 is identical in both inputs, so the
    // LCS walker keeps it as a ' ' context line. The lines around it
    // change → '-'/'+' pairs.
    expect(out.hunks[0]!.lines).toEqual([
      { kind: '-', text: 'one' },
      { kind: '+', text: 'ONE' },
      { kind: ' ', text: '' },
      { kind: '-', text: 'three' },
      { kind: '+', text: 'THREE' }
    ]);
  });
});
