/**
 * ast-grep pattern preparation — regex detect, decorator rewrite, zero-hit hints.
 */

import { describe, expect, it } from 'vitest';
import {
  buildZeroHitHints,
  looksLikeRegexQuery,
  prepareSearchPattern
} from '@main/astgrep/patterns.js';

describe('looksLikeRegexQuery', () => {
  it('detects common grep patterns', () => {
    expect(looksLikeRegexQuery('class .*Tool\\(')).toBe(true);
    expect(looksLikeRegexQuery('foo|bar')).toBe(true);
    expect(looksLikeRegexQuery('export function $NAME')).toBe(false);
  });
});

describe('prepareSearchPattern', () => {
  it('keeps explicit metavariable patterns as AST', () => {
    const r = prepareSearchPattern('class $NAME', 'python');
    expect(r.matcher).toBe('ast');
    expect(r.patternText).toBe('class $NAME');
    expect(r.autoNote).toBeUndefined();
  });

  it('routes grep regex to line regex matcher', () => {
    const r = prepareSearchPattern('class .*Tool\\(', 'python');
    expect(r.matcher).toBe('regex');
    expect(r.patternText).toBe('class .*Tool\\(');
    expect(r.autoNote).toMatch(/grep-style regex/i);
  });

  it('routes @decorator queries to regex with hint', () => {
    const r = prepareSearchPattern('@dataclass', 'python');
    expect(r.matcher).toBe('regex');
    expect(r.patternText).toBe('@dataclass');
    expect(r.autoNote).toMatch(/decorator/i);
  });

  it('expands TS identifiers to AST', () => {
    const r = prepareSearchPattern('helloWorld', 'typescript');
    expect(r.matcher).toBe('ast');
    expect(r.patternText).toBe('helloWorld');
    expect(r.autoNote).toMatch(/identifier/i);
  });

  it('uses word-boundary regex for Python identifiers', () => {
    const r = prepareSearchPattern('helloWorld', 'python');
    expect(r.matcher).toBe('regex');
    expect(r.patternText).toBe('\\bhelloWorld\\b');
  });
});

describe('buildZeroHitHints', () => {
  it('suggests AST patterns for regex misuse', () => {
    const prepared = prepareSearchPattern('class .*Tool\\(', 'python');
    const hints = buildZeroHitHints(prepared, 'python', 'class .*Tool(');
    expect(hints).toMatch(/metavariables/i);
  });

  it('suggests decorated-def pattern for @dataclass', () => {
    const prepared = prepareSearchPattern('@dataclass', 'python');
    const hints = buildZeroHitHints(prepared, 'python', '@dataclass');
    expect(hints).toMatch(/@\$DEC/i);
  });

  it('suggests kind-specific hints', () => {
    const prepared = prepareSearchPattern('function_declaration', 'typescript');
    const hints = buildZeroHitHints(prepared, 'typescript', 'function_declaration', {
      kindSearch: true
    });
    expect(hints).toMatch(/kind/i);
  });
});
