/**
 * `clampQuery` — pin the prompt-head preservation contract (T0-4).
 *
 * The earlier `clampQuery(s)` clamp kept a single trailing window of
 * `MAX_QUERY_CHARS` (600). When the user's prompt itself was longer
 * than the budget, the prompt's HEAD was dropped and memory retrieval
 * keyed on exploration signal alone — losing the goal verb. The new
 * shape `clampQuery(s, originalPrompt)` reserves the first
 * `PROMPT_HEAD_BUDGET` chars of the prompt at the head of the output
 * and fills the remaining budget from the trailing tail of `s`.
 *
 * The helper is exported from `runLoop.ts` via `__test_clampQuery`
 * exclusively for this test (the runtime callers consume it via the
 * file-local symbol). Keeping the export tagged with `__test_` makes
 * the seam unambiguous in dead-code reports.
 */

import { describe, expect, it } from 'vitest';
import { __test_clampQuery as clampQuery } from '@main/orchestrator/loop/runLoop';

const MAX_QUERY_CHARS = 600;
const PROMPT_HEAD_BUDGET = 200;

describe('clampQuery (T0-4) — preserves the user-prompt head', () => {
  it('returns the input unchanged when it already fits the budget', () => {
    const prompt = 'short user prompt';
    const out = clampQuery(`${prompt} ls src/main`, prompt);
    expect(out).toBe(`${prompt} ls src/main`);
  });

  it('preserves the first PROMPT_HEAD_BUDGET chars of the prompt at the head', () => {
    // Build a prompt longer than the head budget, then a tail of
    // exploration noise that pushes the combined string past the
    // overall cap.
    const prompt = 'A'.repeat(PROMPT_HEAD_BUDGET + 100);
    const tail = ' ' + 'B'.repeat(MAX_QUERY_CHARS); // forces overflow
    const out = clampQuery(prompt + tail, prompt);
    // Output starts with exactly the reserved head chunk of the prompt.
    expect(out.startsWith('A'.repeat(PROMPT_HEAD_BUDGET))).toBe(true);
    // And the total length never exceeds the cap.
    expect(out.length).toBeLessThanOrEqual(MAX_QUERY_CHARS);
  });

  it('drops the duplicated prompt body before sampling the tail', () => {
    // The caller composes `${prompt} ${directQuery}` and hands that
    // single string in. Without the prefix-strip, the head + the
    // tail window would both contain the prompt body and waste the
    // budget. Verifies the de-dup branch fires.
    const prompt = 'pick a model that is fast';
    const directQuery = 'C'.repeat(MAX_QUERY_CHARS);
    const out = clampQuery(`${prompt} ${directQuery}`, prompt);
    // The head chunk shows up exactly ONCE — not twice.
    const head = prompt.slice(0, PROMPT_HEAD_BUDGET);
    const occurrences = out.split(head).length - 1;
    expect(occurrences).toBe(1);
    // The freshest tail ('C' chars) makes it into the output.
    expect(out).toContain('C');
  });

  it('returns just the prompt head when the trailing tail is empty', () => {
    // When the input is exactly `originalPrompt` (no extras), the
    // remainder after de-dup is empty and the function returns the
    // reserved head alone. This pins that the function never returns
    // the empty string when the input was non-empty.
    const prompt = 'D'.repeat(MAX_QUERY_CHARS);
    // Pass `prompt` with one trailing space appended so the input
    // exceeds `MAX_QUERY_CHARS` and we enter the clamp branch (the
    // early-return short-circuits on inputs that already fit). The
    // remainder after stripping `prompt` is the empty string, so the
    // function returns just the reserved head.
    const out = clampQuery(prompt + ' '.repeat(50), prompt);
    expect(out.length).toBe(PROMPT_HEAD_BUDGET);
    expect(out).toBe('D'.repeat(PROMPT_HEAD_BUDGET));
  });

  it('keeps the trailing exploration signal when the prompt is short', () => {
    // Short prompt → tail budget grows → exploration signal survives.
    const prompt = 'audit the orchestrator';
    const tail = ' ls src/main read src/main/index.ts memory list workspace';
    const longTail = tail.repeat(40); // overflows budget
    const out = clampQuery(prompt + longTail, prompt);
    // The literal prompt head is still present.
    expect(out.startsWith(prompt)).toBe(true);
    // Most-recent exploration tokens land in the tail window.
    expect(out).toContain('memory list workspace');
    expect(out.length).toBeLessThanOrEqual(MAX_QUERY_CHARS);
  });
});
