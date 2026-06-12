/**
 * Audit fix A4 — pre-seeded `read` cache hits for inlined files.
 *
 * Pins:
 *   - A seeded entry short-circuits the next `read({ path })` for the
 *     same path under the same run `AbortSignal`.
 *   - The seeded hit's `output` is the host-authored explanation
 *     verbatim — NO "[cache] this exact call has already been issued"
 *     banner prefix.
 *   - A read with `startLine` / `endLine` MUST bypass the seed.
 *   - `seedCachedRead` is idempotent for the same `(signal, rel)`.
 */

import { describe, expect, it } from 'vitest';
import {
  clearRunCache,
  lookupCachedResult,
  seedCachedRead
} from '@main/orchestrator/toolResultCache';

describe('seedCachedRead', () => {
  it('short-circuits a bare read({ path }) with the host-authored output', () => {
    const sig = new AbortController().signal;
    seedCachedRead(sig, 'core/agent.py');
    const hit = lookupCachedResult(sig, 'read', { path: 'core/agent.py' });
    expect(hit).not.toBeNull();
    expect(hit!.ok).toBe(true);
    expect(hit!.output).toContain('inlined into the <attached_files> block');
    expect(hit!.output).not.toMatch(/^\[cache\] This exact `read` call/);
    clearRunCache(sig);
  });

  it('does NOT short-circuit a read with an explicit line range', () => {
    const sig = new AbortController().signal;
    seedCachedRead(sig, 'core/agent.py');
    const hit = lookupCachedResult(
      sig,
      'read',
      { path: 'core/agent.py', startLine: 1, endLine: 10 }
    );
    expect(hit).toBeNull();
    clearRunCache(sig);
  });

  it('different runs (different signals) do not share seeds', () => {
    const sigA = new AbortController().signal;
    const sigB = new AbortController().signal;
    seedCachedRead(sigA, 'core/agent.py');
    expect(lookupCachedResult(sigB, 'read', { path: 'core/agent.py' })).toBeNull();
    clearRunCache(sigA);
  });

  it('is idempotent — second seed does not overwrite', () => {
    const sig = new AbortController().signal;
    seedCachedRead(sig, 'core/agent.py');
    seedCachedRead(sig, 'core/agent.py');
    const hit = lookupCachedResult(sig, 'read', { path: 'core/agent.py' });
    expect(hit!.output).toContain('inlined into the <attached_files> block');
    clearRunCache(sig);
  });
});
