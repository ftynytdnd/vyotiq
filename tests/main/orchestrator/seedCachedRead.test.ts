/**
 * Audit fix A4 — pre-seeded `read` cache hits for sub-agent inlined
 * files.
 *
 * Pins:
 *   - A seeded entry short-circuits the next `read({ path })` for the
 *     same path under the same `(signal, subagentId)` bucket.
 *   - The seeded hit's `output` is the host-authored explanation
 *     verbatim — NO "[cache] this exact call has already been issued"
 *     banner prefix. (Banner pollution on the first read of a seeded
 *     file would lie to the model.)
 *   - The seed only applies to a bare `{ path }` call. A read with
 *     `startLine` / `endLine` MUST bypass the seed so the worker
 *     can still fetch line ranges beyond the inline cap.
 *   - Seed scope is per `(signal, subagentId)` — orchestrator and
 *     sibling workers never see another worker's seed.
 *   - `seedCachedRead` is idempotent — calling twice for the same
 *     `(signal, subagentId, rel)` doesn't overwrite a live entry.
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
    seedCachedRead(sig, 'sub-A', 'core/agent.py');
    const hit = lookupCachedResult(sig, 'read', { path: 'core/agent.py' }, 'sub-A');
    expect(hit).not.toBeNull();
    expect(hit!.ok).toBe(true);
    // The seeded output describes the inlined-file short-circuit.
    expect(hit!.output).toContain('inlined into the <files> block');
    // CRITICAL: no "[cache] This exact `read` call has already been
    // issued" prefix — the banner would lie on the first read.
    expect(hit!.output).not.toMatch(/^\[cache\] This exact `read` call/);
    clearRunCache(sig);
  });

  it('does NOT short-circuit a read with an explicit line range', () => {
    const sig = new AbortController().signal;
    seedCachedRead(sig, 'sub-A', 'core/agent.py');
    // A range-scoped read has different args → different cache key →
    // miss → real tool runs.
    const hit = lookupCachedResult(
      sig,
      'read',
      { path: 'core/agent.py', startLine: 1, endLine: 10 },
      'sub-A'
    );
    expect(hit).toBeNull();
    clearRunCache(sig);
  });

  it('is scoped per (signal, subagentId)', () => {
    const sig = new AbortController().signal;
    seedCachedRead(sig, 'sub-A', 'core/agent.py');
    // Sibling worker should NOT see the seed.
    expect(
      lookupCachedResult(sig, 'read', { path: 'core/agent.py' }, 'sub-B')
    ).toBeNull();
    // Orchestrator (subagentId === undefined) should NOT see the seed.
    expect(
      lookupCachedResult(sig, 'read', { path: 'core/agent.py' })
    ).toBeNull();
    clearRunCache(sig);
  });

  it('different runs (different signals) do not share seeds', () => {
    const sigA = new AbortController().signal;
    const sigB = new AbortController().signal;
    seedCachedRead(sigA, 'sub-A', 'core/agent.py');
    expect(
      lookupCachedResult(sigB, 'read', { path: 'core/agent.py' }, 'sub-A')
    ).toBeNull();
    clearRunCache(sigA);
  });

  it('is idempotent — repeated seeding leaves the first entry alone', () => {
    const sig = new AbortController().signal;
    seedCachedRead(sig, 'sub-A', 'core/agent.py');
    seedCachedRead(sig, 'sub-A', 'core/agent.py');
    seedCachedRead(sig, 'sub-A', 'core/agent.py');
    const hit = lookupCachedResult(sig, 'read', { path: 'core/agent.py' }, 'sub-A');
    expect(hit).not.toBeNull();
    expect(hit!.output).toContain('inlined into the <files> block');
    clearRunCache(sig);
  });
});
