/**
 * Tests for the run-scoped tool-result cache. Pins the four invariants
 * the orchestrator depends on:
 *
 *   1. Read-shaped calls (ls/read/search/recall + memory list/read) are
 *      memoized and the second hit short-circuits tool execution with a
 *      "you already did this" banner prepended.
 *   2. Write-shaped calls (edit/delete/bash/report/capture, sg apply,
 *      memory write/append) invalidate the entire per-signal cache so
 *      subsequent reads see fresh state.
 *   3. Failed results are NEVER cached — a transient failure must not
 *      poison the cache.
 *   4. Different AbortSignals (= different runs) do not share entries.
 *
 * The tests drive the cache helpers directly rather than via
 * `runToolByName` so they stay isolated from the rest of the tool
 * machinery (sandbox, confirm bus, etc.).
 */

import { describe, expect, it } from 'vitest';
import type { ToolResult } from '@shared/types/tool';
import {
  clearRunCache,
  lookupCachedResult,
  recordToolResult
} from '@main/orchestrator/toolResultCache';

function okResult(output: string): ToolResult {
  return {
    id: 'tc-1',
    name: 'read',
    ok: true,
    output,
    durationMs: 1
  };
}

describe('toolResultCache', () => {
  it('returns null when no prior call was recorded', () => {
    const sig = new AbortController().signal;
    expect(lookupCachedResult(sig, 'read', { path: 'a.ts' })).toBeNull();
  });

  it('memoizes a successful read and prepends a banner on the second hit', () => {
    const sig = new AbortController().signal;
    const first = okResult('contents of a.ts');
    recordToolResult(sig, 'read', { path: 'a.ts' }, first);

    const hit = lookupCachedResult(sig, 'read', { path: 'a.ts' });
    expect(hit).not.toBeNull();
    expect(hit!.ok).toBe(true);
    expect(hit!.output).toContain('contents of a.ts'); // original body preserved
    expect(hit!.output.startsWith('[cache]')).toBe(true); // banner prepended
    expect(hit!.output).toMatch(/already been issued/);
  });

  /**
   * Subtraction-pass anti-revert pin (Stanford "Orchestration Over
   * Architecture" §Subtraction Principle).
   *
   * The host-side direct-tool spin detector + nudge + halt path was
   * removed because THIS cache banner already covers the same
   * condition strictly EARLIER: the spin detector fired on the third
   * identical call; the banner fires on the SECOND. If the banner
   * regresses (or stops firing on the 2nd hit) the formerly-redundant
   * spin detector becomes load-bearing again — and we'd have to
   * un-revert that whole subsystem. This test pins the contract so
   * that can't happen silently:
   *
   *   - Banner MUST fire on the very first cache hit (i.e. the
   *     model's SECOND identical call across the run).
   *   - Banner copy MUST tell the model the call is a no-op AND
   *     suggest pivoting to a planning / edit step.
   *
   * The banner copy is the model's only host-side signal that it's
   * spinning. If the prose loses the "move to a planning or edit
   * step" hint, the model has nothing to pivot toward.
   */
  it('subtraction-pass: cache banner owns spin coverage on the 2nd identical call', () => {
    const sig = new AbortController().signal;
    recordToolResult(sig, 'ls', { path: 'src' }, okResult('src/\n  index.ts'));

    const secondCall = lookupCachedResult(sig, 'ls', { path: 'src' });
    expect(secondCall).not.toBeNull();
    expect(secondCall!.output.startsWith('[cache]')).toBe(true);
    // The banner must explicitly tell the model the call is a no-op
    // — that's how the model recognises it should pivot. Without the
    // "no-op" framing the banner could be misread as a transient cache
    // hit that might next time return fresh data.
    expect(secondCall!.output).toMatch(/may be stale|output has not changed/i);
    // The banner must hand the model a concrete pivot recommendation.
    // This is the line that replaces the deleted spin nudge's
    // "Either emit a `<delegate ... />` directive or finalize the
    // answer" copy.
    expect(secondCall!.output).toMatch(/move to planning or edit/i);
  });

  it('treats argument key order as insignificant (stable hash)', () => {
    const sig = new AbortController().signal;
    recordToolResult(sig, 'read', { path: 'a.ts', offset: 10 }, okResult('body'));
    const hit = lookupCachedResult(sig, 'read', { offset: 10, path: 'a.ts' });
    expect(hit).not.toBeNull();
  });

  it('does not cache failed results', () => {
    const sig = new AbortController().signal;
    recordToolResult(
      sig,
      'read',
      { path: 'missing.ts' },
      {
        id: 'tc',
        name: 'read',
        ok: false,
        output: 'ENOENT',
        error: 'ENOENT',
        durationMs: 1
      }
    );
    expect(lookupCachedResult(sig, 'read', { path: 'missing.ts' })).toBeNull();
  });

  it('does not cache write-shaped tools', () => {
    const sig = new AbortController().signal;
    recordToolResult(
      sig,
      'edit',
      { filePath: 'a.ts' },
      {
        id: 'tc',
        name: 'edit',
        ok: true,
        output: 'ok',
        durationMs: 1
      }
    );
    expect(lookupCachedResult(sig, 'edit', { filePath: 'a.ts' })).toBeNull();
  });

  /**
   * Regression for the 14×-read loop — after the first successful read
   * the model should get SAME result with a banner on subsequent
   * identical calls. Tool execution never re-runs.
   */
  it('short-circuits the 14-read loop', () => {
    const sig = new AbortController().signal;
    recordToolResult(sig, 'read', { path: 'x.ts' }, okResult('body of x'));
    for (let i = 0; i < 13; i++) {
      const hit = lookupCachedResult(sig, 'read', { path: 'x.ts' });
      expect(hit).not.toBeNull();
      expect(hit!.output).toContain('body of x');
      expect(hit!.output).toMatch(/already been issued/);
    }
  });

  it('invalidates the cache when a write-shaped tool runs', () => {
    const sig = new AbortController().signal;
    recordToolResult(sig, 'read', { path: 'a.ts' }, okResult('before edit'));
    // Sanity: the cache is populated.
    expect(lookupCachedResult(sig, 'read', { path: 'a.ts' })).not.toBeNull();

    // A write-shaped tool runs; this must evict cached reads.
    recordToolResult(
      sig,
      'edit',
      { filePath: 'a.ts' },
      { id: 'tc', name: 'edit', ok: true, output: 'ok', durationMs: 1 }
    );

    expect(lookupCachedResult(sig, 'read', { path: 'a.ts' })).toBeNull();
  });

  it('invalidates the cache when a delete runs (fresh reads after removal)', () => {
    const sig = new AbortController().signal;
    recordToolResult(sig, 'read', { path: 'gone.ts' }, okResult('still here'));
    recordToolResult(sig, 'ls', { path: '.' }, { ...okResult('gone.ts'), name: 'ls' });
    expect(lookupCachedResult(sig, 'read', { path: 'gone.ts' })).not.toBeNull();

    // delete mutates the workspace — cached reads/listings must be evicted.
    recordToolResult(
      sig,
      'delete',
      { path: 'gone.ts' },
      { id: 'tc', name: 'delete', ok: true, output: 'Deleted gone.ts', durationMs: 1 }
    );

    expect(lookupCachedResult(sig, 'read', { path: 'gone.ts' })).toBeNull();
    expect(lookupCachedResult(sig, 'ls', { path: '.' })).toBeNull();
  });

  it('invalidates the cache when a report runs (writes under .vyotiq/reports)', () => {
    const sig = new AbortController().signal;
    recordToolResult(sig, 'ls', { path: '.vyotiq/reports' }, { ...okResult('(empty)'), name: 'ls' });
    expect(lookupCachedResult(sig, 'ls', { path: '.vyotiq/reports' })).not.toBeNull();

    recordToolResult(
      sig,
      'report',
      { title: 'Audit' },
      { id: 'tc', name: 'report', ok: true, output: 'wrote report', durationMs: 1 }
    );

    expect(lookupCachedResult(sig, 'ls', { path: '.vyotiq/reports' })).toBeNull();
  });

  it('invalidates the cache when capture writes a screenshot file', () => {
    const sig = new AbortController().signal;
    recordToolResult(sig, 'read', { path: '.vyotiq/captures/shot.png' }, okResult('(missing)'));
    expect(lookupCachedResult(sig, 'read', { path: '.vyotiq/captures/shot.png' })).not.toBeNull();

    recordToolResult(
      sig,
      'capture',
      { target: 'screen' },
      { id: 'tc', name: 'capture', ok: true, output: 'saved capture', durationMs: 1 }
    );

    expect(lookupCachedResult(sig, 'read', { path: '.vyotiq/captures/shot.png' })).toBeNull();
  });

  it('invalidates the cache when sg runs with apply: true but not for dry runs', () => {
    const sig = new AbortController().signal;
    recordToolResult(sig, 'read', { path: 'src/index.ts' }, okResult('before sg'));

    recordToolResult(
      sig,
      'sg',
      { action: 'run', pattern: 'foo', rewrite: 'bar', apply: false },
      { id: 'tc', name: 'sg', ok: true, output: 'dry run', durationMs: 1 }
    );
    expect(lookupCachedResult(sig, 'read', { path: 'src/index.ts' })).not.toBeNull();

    recordToolResult(
      sig,
      'sg',
      { action: 'run', pattern: 'foo', rewrite: 'bar', apply: true },
      { id: 'tc2', name: 'sg', ok: true, output: 'applied', durationMs: 1 }
    );
    expect(lookupCachedResult(sig, 'read', { path: 'src/index.ts' })).toBeNull();
  });

  it('treats memory write/append as invalidating but memory read/list as cacheable', () => {
    const sig = new AbortController().signal;
    recordToolResult(
      sig,
      'memory',
      { action: 'read', scope: 'global', key: 'notes' },
      { id: 'tc', name: 'memory', ok: true, output: 'contents', durationMs: 1 }
    );
    expect(
      lookupCachedResult(sig, 'memory', { action: 'read', scope: 'global', key: 'notes' })
    ).not.toBeNull();

    // memory write must evict the cached memory read.
    recordToolResult(
      sig,
      'memory',
      { action: 'write', scope: 'global', key: 'notes' },
      { id: 'tc', name: 'memory', ok: true, output: 'ok', durationMs: 1 }
    );
    expect(
      lookupCachedResult(sig, 'memory', { action: 'read', scope: 'global', key: 'notes' })
    ).toBeNull();
  });

  it('does not cache memory write/append even on success', () => {
    const sig = new AbortController().signal;
    recordToolResult(
      sig,
      'memory',
      { action: 'append', scope: 'global', key: 'log' },
      { id: 'tc', name: 'memory', ok: true, output: 'appended', durationMs: 1 }
    );
    expect(
      lookupCachedResult(sig, 'memory', { action: 'append', scope: 'global', key: 'log' })
    ).toBeNull();
  });

  it('does not share entries across different AbortSignals', () => {
    const sigA = new AbortController().signal;
    const sigB = new AbortController().signal;
    recordToolResult(sigA, 'read', { path: 'a.ts' }, okResult('A-body'));
    expect(lookupCachedResult(sigA, 'read', { path: 'a.ts' })).not.toBeNull();
    expect(lookupCachedResult(sigB, 'read', { path: 'a.ts' })).toBeNull();
  });

  it('clearRunCache drops all entries for a signal', () => {
    const sig = new AbortController().signal;
    recordToolResult(sig, 'read', { path: 'a.ts' }, okResult('body'));
    recordToolResult(sig, 'ls', { path: '.' }, { ...okResult('listing'), name: 'ls' });
    clearRunCache(sig);
    expect(lookupCachedResult(sig, 'read', { path: 'a.ts' })).toBeNull();
    expect(lookupCachedResult(sig, 'ls', { path: '.' })).toBeNull();
  });

  it('hit counter increments per lookup and is reflected in the banner', () => {
    const sig = new AbortController().signal;
    recordToolResult(sig, 'read', { path: 'a.ts' }, okResult('body'));
    const hit1 = lookupCachedResult(sig, 'read', { path: 'a.ts' })!;
    expect(hit1.output).toMatch(/1 time\b/);
    const hit2 = lookupCachedResult(sig, 'read', { path: 'a.ts' })!;
    expect(hit2.output).toMatch(/2 times\b/);
  });

  it('shares read hits across runs in the same conversation', () => {
    const sigA = new AbortController().signal;
    const sigB = new AbortController().signal;
    const conv = 'conv-1';
    recordToolResult(sigA, 'read', { path: 'a.ts' }, okResult('shared'), conv);
    expect(lookupCachedResult(sigB, 'read', { path: 'a.ts' }, conv)).not.toBeNull();
    expect(lookupCachedResult(sigB, 'read', { path: 'a.ts' })).toBeNull();
  });
});
