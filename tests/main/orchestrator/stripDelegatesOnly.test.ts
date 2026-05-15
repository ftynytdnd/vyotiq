/**
 * `stripDelegatesOnly` — narrow companion to the broader
 * `stripDelegates` strip used by the renderer. Pins the contract that
 * makes the previously-unused `DELEGATE_PAIR_RE` /
 * `DELEGATE_SELFCLOSE_RE` regexes a real, exercised public API:
 *
 *   1. Removes paired `<delegate>...</delegate>` and self-closing
 *      `<delegate ... />` (and the `<delegate>` shorthand the model
 *      sometimes emits).
 *   2. PRESERVES every OTHER `ORCHESTRATION_TAG_NAMES` member
 *      (`<status>`, `<task>`, `<result>`, `<run_state>`,
 *      `<tool_calls>`, the `<think>`-family) and DSML envelopes —
 *      callers that already parsed the delegates can keep the rest of
 *      the orchestration scaffolding intact for downstream use.
 *   3. Parity with `parseDelegates`: the parsed-directive count must
 *      equal the number of delegate matches the strip removes for any
 *      input that has been through `parseDelegates`. A future regex
 *      drift on either side is caught here.
 */

import { describe, expect, it } from 'vitest';
import {
  parseDelegates,
  stripDelegatesOnly
} from '@main/orchestrator/envelope/index.js';

function delegateMatchCount(text: string): number {
  // Crude but deterministic: count occurrences of `<delegate` that
  // open a tag (no closing-bracket form). This deliberately doesn't
  // distinguish self-closing from paired — the parity check below
  // tolerates either as long as parseDelegates and the strip agree
  // on the same shape.
  return (text.match(/<delegate\b/gi) ?? []).length;
}

describe('stripDelegatesOnly', () => {
  it('strips a self-closing delegate', () => {
    const out = stripDelegatesOnly('plan\n<delegate id="A1" task="x" />\n');
    expect(out).toBe('plan');
    expect(out).not.toContain('<delegate');
  });

  it('strips a paired delegate block', () => {
    const out = stripDelegatesOnly(
      'before\n<delegate id="A1">inner</delegate>\nafter'
    );
    expect(out).not.toContain('<delegate');
    expect(out).toContain('before');
    expect(out).toContain('after');
  });

  it('preserves other orchestration tags (status, task, run_state, tool_calls)', () => {
    const input =
      'narrate\n' +
      '<status>working</status>\n' +
      '<task id="t1" />\n' +
      '<run_state iter="2"></run_state>\n' +
      '<tool_calls>{"name":"ls"}</tool_calls>\n' +
      '<delegate id="A1" task="x" />\n' +
      'tail';

    const out = stripDelegatesOnly(input);
    expect(out).not.toContain('<delegate');
    // Every NON-delegate orchestration tag must survive.
    expect(out).toContain('<status>working</status>');
    expect(out).toContain('<task id="t1" />');
    expect(out).toContain('<run_state iter="2"></run_state>');
    expect(out).toContain('<tool_calls>{"name":"ls"}</tool_calls>');
  });

  it('preserves bare DSML envelopes (the broader strip removes them; we do not)', () => {
    // A bare `</| ... |>` envelope is part of the broader strip's
    // remit but NOT this narrow strip — it is not a delegate.
    const out = stripDelegatesOnly('a\n</| | DSML | | tool_calls>\nb');
    expect(out).toContain('</| | DSML | | tool_calls>');
  });

  it('leaves unrelated `<` characters untouched', () => {
    expect(stripDelegatesOnly('use std::vector<int> here')).toBe(
      'use std::vector<int> here'
    );
    expect(stripDelegatesOnly('Vue uses <template> blocks.')).toBe(
      'Vue uses <template> blocks.'
    );
  });

  it('parity with parseDelegates: removed-tag count equals parsed-directive count', () => {
    const cases: string[] = [
      // No delegates at all.
      'just prose, nothing structured',
      // Single self-closing.
      '<delegate id="A1" task="x" />',
      // Single paired.
      '<delegate id="A1" task="y">body</delegate>',
      // Two siblings.
      '<delegate id="A1" task="x" />\n<delegate id="A2" task="y" />',
      // Mixed with other orchestration around them.
      '<status>idle</status>\n<delegate id="A1" task="x" />\n<task id="t1" />',
      // Three delegates with surrounding prose.
      [
        'Plan:',
        '<delegate id="A1" task="t1" />',
        'Inline status:',
        '<status>spawning</status>',
        '<delegate id="A2" task="t2" />',
        '<delegate id="A3" task="t3" />',
        'done.'
      ].join('\n')
    ];

    for (const input of cases) {
      const before = delegateMatchCount(input);
      const after = delegateMatchCount(stripDelegatesOnly(input));
      // Strip must remove every delegate-opening occurrence.
      expect(after).toBe(0);

      const directives = parseDelegates(input);
      // The parser dedupes by id; if the input has duplicate-id
      // directives the parser may report fewer than the strip
      // removes. None of the cases above have duplicate ids, so the
      // counts must match exactly.
      expect(directives.length).toBe(before);
    }
  });
});
