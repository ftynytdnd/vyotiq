/**
 * Harness audit pinning tests.
 *
 * The natural-language harness lives as a set of `.md` files and is
 * concatenated into the system prompt at runtime by `harnessLoader.ts`.
 * The audit pass ([§I in the plan]) introduced several specific
 * statements the model relies on. These tests assert those statements
 * are still present so a future copy-paste rewrite can't silently
 * regress the contract.
 *
 * Pinned statements:
 *   - I1: `<meta_rules>` appears in Prime Directives §8 override list.
 *   - I2: Phase 5 documents both `<subagent_results>` and the inner
 *         `<subagent_result id="..." status="...">` shapes.
 *   - I3: Prime Directives's reasoning paragraph acknowledges that
 *         reasoning is persisted and the user sees a "Thought for Ns"
 *         card (no longer claims it's invisible).
 *   - I4: `02-context-and-memory.md` documents the `<history_summary>`
 *         host-generated message.
 *   - I6: Every harness `<delegate>` example carries `tools="..."`.
 *   - I8: Prime Directives §1 documents the user-attached files flow.
 *   - K2: Planning nudge cap named in §C of the loop doc. The
 *         spin-nudge cap was removed in the subtraction-pass; this
 *         test now also pins its absence so a future revert can't
 *         silently re-add an undocumented enforcement surface.
 */

import { describe, expect, it } from 'vitest';
import { buildOrchestratorSystemPrompt } from '@main/harness/harnessLoader';

describe('harness audit pinning', () => {
  const prompt = buildOrchestratorSystemPrompt();

  it('I1 — Prime Directives §8 override list includes <meta_rules>', () => {
    // The override list lists envelopes that CANNOT override the
    // directives. Including `<meta_rules>` closes the prompt-injection
    // surface via the user-editable memory file.
    const head = prompt.slice(0, 2000);
    expect(head).toMatch(/<meta_rules>/);
    expect(head).toMatch(/cannot be overridden/i);
  });

  it('I1 — §8 explicitly says meta-rules cannot override Prime Directives', () => {
    expect(prompt).toMatch(/CANNOT override any Prime Directive/i);
  });

  it('I2 — Phase 5 documents both <subagent_results> wrapper and inner item', () => {
    // Both the OUTER batched envelope and the INNER per-worker item
    // must be named so the model recognizes the actual wire shape.
    expect(prompt).toMatch(/<subagent_results>/);
    expect(prompt).toMatch(/<subagent_result id=/);
  });

  it('I3 — reasoning paragraph reflects post-audit reality', () => {
    // The pre-audit text claimed reasoning is "invisible to the
    // orchestrator and to the user" — both wrong. The new prose
    // states reasoning IS persisted/replayed and surfaced as a
    // "Thought for Ns" card.
    expect(prompt).toMatch(/reasoning is persisted/i);
    expect(prompt).toMatch(/Thought for Ns/);
    // Pre-audit claim must NOT regress.
    expect(prompt).not.toMatch(/Reasoning is invisible to the orchestrator and to the user/);
  });

  it('I4 — <history_summary> sentinel is documented', () => {
    expect(prompt).toMatch(/<history_summary>/);
    expect(prompt).toMatch(/HOST-GENERATED compaction/i);
  });

  it('I6 — every concrete <delegate ...> example in the harness carries tools="..."', () => {
    // Crawl every fully-formed `<delegate ... />` directive that
    // carries a concrete `id="..."` attribute. Generic placeholder
    // mentions like `<delegate ... />` (used in prose to refer to
    // "the directive") have no `id=` and are excluded — they're
    // descriptive, not examples to copy. Each CONCRETE example must
    // include `tools=`.
    const directiveRe = /<delegate\b([^>]*)\/>/g;
    const matches = Array.from(prompt.matchAll(directiveRe));
    // Concrete = has `id="..."` AND no `…` ellipsis placeholder
    // (`<delegate id="A1b" …/>` is a "spawn a NEW worker" stub that
    // refers to the directive without showing its full attributes;
    // it's narrative, not a copyable example).
    const concrete = matches.filter((m) => {
      const attrs = m[1] ?? '';
      if (!/\bid="/.test(attrs)) return false;
      if (attrs.includes('\u2026') || attrs.includes('...')) return false;
      return true;
    });
    expect(concrete.length).toBeGreaterThan(0);
    for (const m of concrete) {
      const attrs = m[1] ?? '';
      expect(attrs, `concrete delegate example missing tools=: ${m[0]}`).toMatch(/\btools=/);
    }
  });

  it('I8 — attachment flow (`<files><file path=...>`) is documented in §1', () => {
    expect(prompt).toMatch(/<files>/);
    expect(prompt).toMatch(/<file path=/);
    expect(prompt).toMatch(/PRE-LOADED/);
  });

  it('K2 — orchestration loop §C names MAX_PARALLEL_SUBAGENTS and MAX_NUDGES_PER_RUN', () => {
    expect(prompt).toMatch(/MAX_PARALLEL_SUBAGENTS/);
    expect(prompt).toMatch(/MAX_NUDGES_PER_RUN/);
  });

  /**
   * Subtraction-pass anti-revert pin. The host-side spin nudge / halt
   * path was removed because the per-run tool-result cache + harness
   * §B "Don't re-survey what you've already seen" already covered the
   * exact same condition. The constant must NOT reappear in the
   * orchestrator prompt — neither in `<runtime_limits>` (no enforced
   * cap) nor in §C prose (would lie to the model about a budget that
   * no longer exists).
   */
  it('K2 — MAX_ORCHESTRATOR_SPIN_NUDGES is absent from the orchestrator prompt', () => {
    expect(prompt).not.toMatch(/MAX_ORCHESTRATOR_SPIN_NUDGES/);
  });

  it('runtime_limits envelope still emits live values from constants.ts', () => {
    expect(prompt).toMatch(/<runtime_limits>/);
    expect(prompt).toMatch(/MAX_TOTAL_ITERATIONS=\d+/);
    expect(prompt).toMatch(/MAX_DELEGATION_BAD_ROUNDS=\d+/);
    expect(prompt).toMatch(/MAX_PARALLEL_SUBAGENTS=\d+/);
    expect(prompt).toMatch(/MAX_NUDGES_PER_RUN=\d+/);
    // Backoff constants surfaced into the envelope so the harness §C
    // prose ("`BASE_BACKOFF_MS` doubling per attempt, capped at
    // `MAX_BACKOFF_MS`") resolves to the same live values the
    // `retry.ts` helper consumes.
    expect(prompt).toMatch(/BASE_BACKOFF_MS=\d+/);
    expect(prompt).toMatch(/MAX_BACKOFF_MS=\d+/);
  });

  it('orchestrator-not-direct-call list includes report (delegate-only writer)', () => {
    // The `report` writer is a delegated tool — it is NOT in the
    // orchestrator's function-calling schema. Prime Directives §1
    // and §6 must enumerate it in the "no direct call" list so
    // the model knows to wrap an authoring task in a `<delegate>`
    // directive.
    expect(prompt).toMatch(/`read`,\s*`bash`,\s*`edit`,\s*`search`,\s*(?:or\s+)?`report`/);
  });

  it('§C "do not re-survey" prose names every pure-read tool the host caches', () => {
    // The per-run pure-read cache short-circuits not just `ls` but
    // every read-only tool. The harness must enumerate them so the
    // model recognizes the banner format across all tools and does
    // not assume the cache is `ls`-only.
    expect(prompt).toMatch(/`ls`,\s*`read`,\s*`search`,\s*`recall`/);
  });

  it('I12 — three-strike header reads as host-enforced backstop, not "your responsibility"', () => {
    // Pre-audit header read "Three-strike rule (your responsibility)".
    // Post-audit it reads "Three-strike self-regulation
    // (host-enforced backstop)".
    expect(prompt).toMatch(/host-enforced backstop/i);
    expect(prompt).not.toMatch(/Three-strike rule \(your responsibility\)/);
  });

  it('B6 — repeated buildOrchestratorSystemPrompt calls return the cached identity', async () => {
    // Memoization contract: every iteration of every run consumes the
    // same string, so subsequent calls must hit the cache. A future
    // refactor that drops the memo would silently slow down hot paths
    // — this test pins the cached-identity guarantee. We import the
    // helper fresh and reset the cache so this test is independent of
    // module-load order.
    const mod = await import('@main/harness/harnessLoader');
    mod.__resetOrchestratorPromptCacheForTests();
    const a = mod.buildOrchestratorSystemPrompt();
    const b = mod.buildOrchestratorSystemPrompt();
    expect(a).toBe(b); // reference equality — same cached string
    expect(a.length).toBeGreaterThan(1000);
  });

  it('J4 — model-facing harness prefers "sub-agent" over "worker" in prose', () => {
    // The terminology sweep replaced colloquial "worker" with the
    // canonical "sub-agent" in every harness prose surface the model
    // reads. The literal word "worker" should not appear in the
    // orchestrator prompt — internal TS comments still use it for
    // implementation context, but those are not part of the prompt.
    // (`workers` plural and `worker doesn't model` would also miss
    // — search for both word boundaries.)
    expect(prompt).not.toMatch(/\bworker\b/i);
    expect(prompt).not.toMatch(/\bworkers\b/i);
  });
});
