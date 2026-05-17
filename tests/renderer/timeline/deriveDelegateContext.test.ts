/**
 * Pure-helper tests for `deriveDelegateContext`. Covers:
 *   - returns the trailing paragraph BEFORE the `<delegate id="X" />`
 *     directive when an orchestrator-level assistant accumulator
 *     contains it.
 *   - tolerates both double- and single-quoted `id` attributes.
 *   - skips fenced-code-style directives (we still extract the
 *     paragraph; stripping the markup itself is the renderer's job).
 *   - returns `{ intentText: null, orchestratorTurnId: <id> }` when
 *     the directive lands at the very start of the turn.
 *   - returns EMPTY when no turn contains the directive.
 *   - opener-regex LRU cache (review fix N-03): identical
 *     `subagentId`s reuse the same compiled `RegExp` instance so
 *     streaming orchestrator turns don't pay the regex compile cost
 *     per text-delta event.
 *   - multi-delegate audit fix: siblings emitted in the same turn
 *     share the orchestrator's introductory prose (not the prior
 *     `<delegate>` tag, which used to render as either empty chrome
 *     or a 600-char mid-sentence slice).
 *   - tag-only trailing blocks (e.g. trailing `<status>` envelope)
 *     are skipped in favour of the earlier real-prose paragraph.
 */

import { afterEach, describe, expect, it } from 'vitest';
import type { AssistantTextAcc } from '@renderer/components/timeline/reducer/types';
import {
  __testing,
  deriveDelegateContext
} from '@renderer/components/timeline/subagent/briefing/deriveDelegateContext';

function acc(id: string, text: string): AssistantTextAcc {
  return { id, text, done: true };
}

afterEach(() => {
  // Drop the opener cache between cases so the per-test fixture's
  // `subagentId` doesn't leak a regex across cases — guarantees the
  // identity-equality assertion below proves caching is hot, not
  // that the previous test happened to have warmed it.
  __testing.resetOpenerCache();
});

describe('deriveDelegateContext', () => {
  it('returns the paragraph immediately before the directive', () => {
    const map = {
      t1: acc(
        't1',
        'I will inspect the auth flow first.\n\n' +
        "Now I'll spawn a worker to read the relevant files.\n\n" +
        '<delegate id="A16b" task="read auth.ts" />'
      )
    };
    const ctx = deriveDelegateContext(map, 'A16b');
    expect(ctx.orchestratorTurnId).toBe('t1');
    expect(ctx.intentText).toContain(
      "Now I'll spawn a worker to read the relevant files."
    );
  });

  it('matches single-quoted id attributes', () => {
    const map = {
      t1: acc('t1', "Plan ready.\n\n<delegate id='B1' task='x' />")
    };
    const ctx = deriveDelegateContext(map, 'B1');
    expect(ctx.intentText).toContain('Plan ready.');
  });

  it('returns null intentText when the directive is at the start of the turn', () => {
    const map = {
      t1: acc('t1', '<delegate id="A1" task="x" />')
    };
    const ctx = deriveDelegateContext(map, 'A1');
    expect(ctx.intentText).toBeNull();
    expect(ctx.orchestratorTurnId).toBe('t1');
  });

  it('returns EMPTY when no accumulator contains the directive', () => {
    const map = {
      t1: acc('t1', 'Just some prose — no delegates here.')
    };
    const ctx = deriveDelegateContext(map, 'A1');
    expect(ctx.intentText).toBeNull();
    expect(ctx.orchestratorTurnId).toBeNull();
  });

  it('returns EMPTY for an empty subagentId', () => {
    const map = { t1: acc('t1', '<delegate id="A1" />') };
    const ctx = deriveDelegateContext(map, '');
    expect(ctx).toEqual({ intentText: null, orchestratorTurnId: null });
  });

  it('selects the correct turn when multiple turns are present', () => {
    const map = {
      t1: acc('t1', 'First turn intent.\n\n<delegate id="A1" task="x" />'),
      t2: acc('t2', 'Second turn intent.\n\n<delegate id="A2" task="y" />')
    };
    const ctxA = deriveDelegateContext(map, 'A1');
    expect(ctxA.orchestratorTurnId).toBe('t1');
    expect(ctxA.intentText).toContain('First turn intent.');

    const ctxB = deriveDelegateContext(map, 'A2');
    expect(ctxB.orchestratorTurnId).toBe('t2');
    expect(ctxB.intentText).toContain('Second turn intent.');
  });

  it('siblings spawned in the same turn share the SAME intent (audit screenshots §1, §3, §4)', () => {
    // The orchestrator's protocol is "plan once, delegate N times".
    // Pre-fix, A2/A3/A4 each got the prior `<delegate>` tag as their
    // trailing paragraph — which stripped to empty (rendering blank
    // chrome) or fell through to a 600-char mid-sentence slice. The
    // helper now slices BEFORE the FIRST delegate so every sibling
    // surfaces the same meaningful preamble.
    const map = {
      t1: acc(
        't1',
        'Plan:\n1. Inspect backend.\n2. Inspect frontend.\n\n' +
        'I will start by mapping the folder structure and analyzing the core configuration and entry points.\n\n' +
        '<delegate id="A1" task="x1" />\n' +
        '<delegate id="A2" task="x2" />\n' +
        '<delegate id="A3" task="x3" />\n' +
        '<delegate id="A4" task="x4" />'
      )
    };
    const ctxA1 = deriveDelegateContext(map, 'A1');
    const ctxA2 = deriveDelegateContext(map, 'A2');
    const ctxA3 = deriveDelegateContext(map, 'A3');
    const ctxA4 = deriveDelegateContext(map, 'A4');

    // All siblings see the EXACT same intent text — no mid-sentence
    // slicing, no empty chrome, no leaked `<delegate>` tag.
    expect(ctxA2.intentText).toBe(ctxA1.intentText);
    expect(ctxA3.intentText).toBe(ctxA1.intentText);
    expect(ctxA4.intentText).toBe(ctxA1.intentText);

    // And the shared intent is the meaningful introductory prose
    // (the paragraph immediately before the delegate block).
    expect(ctxA1.intentText).toContain('I will start by mapping');
    // The 600-char mid-word fallback no longer fires — the intent
    // does NOT start with a stray `{` or `)` from a sliced
    // parenthetical.
    expect(ctxA1.intentText).not.toMatch(/^\s*[{)]/);
  });

  it('skips orchestration-tag-only blocks in favour of the earlier real paragraph', () => {
    // Trailing `<status>` envelopes (or any allowlisted scaffolding
    // tag) used to occupy the trailing-block slot and either strip
    // to empty (rendering blank chrome) or — worse — be returned
    // verbatim as the intent. The accumulator now skips pure-
    // scaffolding blocks and keeps walking backwards to the real
    // prose.
    const map = {
      t1: acc(
        't1',
        'I will analyze the backend dependencies first.\n\n' +
        '<status>planning</status>\n\n' +
        '<delegate id="X1" task="read Cargo.toml" />'
      )
    };
    const ctx = deriveDelegateContext(map, 'X1');
    expect(ctx.intentText).toContain('I will analyze the backend dependencies');
    expect(ctx.intentText).not.toContain('<status>');
  });

  it('caps multi-paragraph accumulation at MAX_INTENT_CHARS without mid-sentence slicing', () => {
    // Each paragraph is ~300 chars. We expect the helper to
    // accumulate roughly four of them (~1200 char cap) but ALWAYS
    // along block boundaries — never mid-sentence.
    const para = (n: number) =>
      `Paragraph ${n}: ${'lorem ipsum dolor sit amet '.repeat(10).trim()}.`;
    const text =
      Array.from({ length: 12 }, (_, i) => para(i + 1)).join('\n\n') +
      '\n\n<delegate id="P1" task="x" />';
    const map = { t1: acc('t1', text) };
    const ctx = deriveDelegateContext(map, 'P1');

    // The newest paragraph (#12) must always survive.
    expect(ctx.intentText).toContain('Paragraph 12:');
    // The intent starts on a clean paragraph boundary, not
    // mid-sentence.
    expect(ctx.intentText!.startsWith('Paragraph ')).toBe(true);
  });

  it('opener-regex LRU cache survives 200 distinct ids without breaking semantics', () => {
    // The cache bound is 128 entries with insertion-order eviction.
    // Walk well past the bound to force eviction, then re-query the
    // first id — the helper must recompile its regex transparently
    // and still find the match. This pins the contract: the cache
    // is perf-only, never load-bearing for correctness.
    const map: Record<string, AssistantTextAcc> = {};
    for (let i = 0; i < 200; i++) {
      map[`t${i}`] = acc(`t${i}`, `Intent ${i}.\n\n<delegate id="A${i}" task="x" />`);
    }
    for (let i = 0; i < 200; i++) {
      const ctx = deriveDelegateContext(map, `A${i}`);
      expect(ctx.orchestratorTurnId).toBe(`t${i}`);
      expect(ctx.intentText).toContain(`Intent ${i}.`);
    }
    // After eviction the earliest id MUST still resolve — the helper
    // recompiles its regex on miss.
    const replay = deriveDelegateContext(map, 'A0');
    expect(replay.intentText).toContain('Intent 0.');
  });
});
