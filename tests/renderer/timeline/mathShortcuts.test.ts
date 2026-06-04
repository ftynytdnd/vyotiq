/**
 * Pure-helper tests for `normalizeMathShortcuts`.
 *
 * Coverage:
 *   - Pipeline arrows (the dominant shortcut by frequency).
 *   - Comparison / equality, arithmetic, set-theory shortcut tables.
 *   - No-op fast path for plain prose (`indexOf('$\\') === -1`).
 *   - Lossless passthrough for unknown LaTeX commands so a real math
 *     user still sees their raw input rather than silently broken
 *     output.
 *   - Multiple occurrences in one string all transformed.
 *   - Idempotent under repeated application.
 */

import { describe, expect, it } from 'vitest';
import { normalizeMathShortcuts } from '@shared/text/mathShortcuts';

describe('normalizeMathShortcuts', () => {
  it('rewrites the pipeline-arrow form used in planning prose', () => {
    const out = normalizeMathShortcuts(
      'AIProvider $\\rightarrow$ NLHarness $\\rightarrow$ FileSystem'
    );
    expect(out).toBe('AIProvider → NLHarness → FileSystem');
  });

  it('rewrites the alternate `$\\to$` arrow shortcut', () => {
    expect(normalizeMathShortcuts('A $\\to$ B')).toBe('A → B');
  });

  it('handles comparison, arithmetic, and set-theory operators in one pass', () => {
    const out = normalizeMathShortcuts(
      'n $\\le$ 5, p $\\neq$ q, a $\\pm$ b, X $\\subseteq$ Y'
    );
    expect(out).toBe('n ≤ 5, p ≠ q, a ± b, X ⊆ Y');
  });

  it('takes the no-op fast path for plain prose (no `$\\` anywhere)', () => {
    const input = 'Just normal prose, no LaTeX. Maybe a $5 mention.';
    expect(normalizeMathShortcuts(input)).toBe(input);
  });

  it('passes unknown LaTeX commands through untouched (lossless)', () => {
    const input = '$\\foobar$ and $\\customMacro$ stay verbatim';
    expect(normalizeMathShortcuts(input)).toBe(input);
  });

  it('is idempotent — running twice yields the same result as running once', () => {
    const once = normalizeMathShortcuts('A $\\Rightarrow$ B');
    const twice = normalizeMathShortcuts(once);
    expect(twice).toBe(once);
    expect(twice).toBe('A ⇒ B');
  });

  it('handles the screenshot §5 case verbatim (JSX-style fragments + arrows)', () => {
    const out = normalizeMathShortcuts(
      '<Header /> $\\rightarrow$ <ChatWindow /> $\\rightarrow$ <InputArea />'
    );
    expect(out).toBe('<Header /> → <ChatWindow /> → <InputArea />');
  });
});
