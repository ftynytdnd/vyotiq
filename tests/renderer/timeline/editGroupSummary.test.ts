/**
 * Tests for `toolGroupSummary` — specifically the `edit` branch's
 * unit pluralisation. Two consecutive edits to the same file used
 * to roll up as "snake.py and 1 other file", which is misleading
 * because the "other" is the same file edited a second time. The
 * fix scopes the wording to invocation count when every child
 * targets a single distinct file path; for true multi-file rounds
 * the "file/files" wording is preserved.
 *
 * Pure function — no DOM.
 */

import { describe, expect, it } from 'vitest';
import { toolGroupSummary } from '@renderer/components/timeline/reducer/deriveRows';
import type { ToolGroupChild } from '@renderer/components/timeline/reducer/deriveRows';
import type { ToolCall } from '@shared/types/tool';

function editChild(path: string): ToolGroupChild {
  const call: ToolCall = {
    id: `call:${path}:${Math.random().toString(36).slice(2)}`,
    name: 'edit',
    args: { path }
  };
  return { callId: call.id, call };
}

describe('toolGroupSummary — edit branch', () => {
  it('single edit shows the file path and no suffix', () => {
    const out = toolGroupSummary('edit', [editChild('src/snake.py')]);
    expect(out.verb).toBe('Edited');
    expect(out.primary).toBe('src/snake.py');
    expect(out.suffix).toBe('');
  });

  it('two edits to the same file → "and 1 more edit"', () => {
    const out = toolGroupSummary('edit', [
      editChild('src/snake.py'),
      editChild('src/snake.py')
    ]);
    expect(out.primary).toBe('src/snake.py');
    expect(out.suffix).toBe(' and 1 more edit');
  });

  it('three edits to the same file → "and 2 more edits"', () => {
    const out = toolGroupSummary('edit', [
      editChild('a.ts'),
      editChild('a.ts'),
      editChild('a.ts')
    ]);
    expect(out.primary).toBe('a.ts');
    expect(out.suffix).toBe(' and 2 more edits');
  });

  it('two edits to distinct files → existing "and 1 other file" wording', () => {
    const out = toolGroupSummary('edit', [
      editChild('a.ts'),
      editChild('b.ts')
    ]);
    expect(out.primary).toBe('a.ts');
    expect(out.suffix).toBe(' and 1 other file');
  });

  it('three edits across distinct files → "and 2 other files"', () => {
    const out = toolGroupSummary('edit', [
      editChild('a.ts'),
      editChild('b.ts'),
      editChild('c.ts')
    ]);
    expect(out.suffix).toBe(' and 2 other files');
  });

  it('mixed same-file and other-file edits use the "files" wording', () => {
    // a.ts twice + b.ts once → distinct count > 1, so the user is
    // genuinely looking at multiple files.
    const out = toolGroupSummary('edit', [
      editChild('a.ts'),
      editChild('a.ts'),
      editChild('b.ts')
    ]);
    expect(out.primary).toBe('a.ts');
    expect(out.suffix).toBe(' and 2 other files');
  });

  it('does not regress read tool roll-up wording', () => {
    // Sanity-check: the scoped change must not bleed into other tools.
    const readChild = (path: string): ToolGroupChild => {
      const call: ToolCall = {
        id: `r:${path}`,
        name: 'read',
        args: { path }
      };
      return { callId: call.id, call };
    };
    const out = toolGroupSummary('read', [
      readChild('a.ts'),
      readChild('a.ts')
    ]);
    // `read` keeps its "file/files" wording — the same-file case is
    // less misleading there (multiple reads against the same file are
    // semantically distinct reads of different ranges).
    expect(out.suffix).toBe(' and 1 other file');
  });
});
