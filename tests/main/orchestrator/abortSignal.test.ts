/**
 * `isAbortError` predicate tests. Single source of truth for detecting
 * user-initiated cancellation across `runLoop`, `SubAgent`, and the
 * confirm bus; keeping a dedicated test file means a future refactor
 * that changes one call site can't silently drift the predicate.
 *
 * Covered shapes:
 *   - `DOMException('…', 'AbortError')` (what real `fetch` throws).
 *   - Plain `Error` with `.name = 'AbortError'` (what some undici
 *     shims produce).
 *   - Wrapped `{ cause: AbortError }` (Node's newer fetch).
 *   - Aborted-signal short-circuit regardless of error shape.
 *   - Non-abort Errors MUST return `false` so real transport
 *     failures still hit the retry/backoff branch.
 */

import { describe, expect, it } from 'vitest';
import { isAbortError } from '@main/orchestrator/abortSignal';

describe('isAbortError', () => {
  it('returns true for a DOMException with name="AbortError"', () => {
    // Node's DOMException constructor is available in modern runtimes
    // (including the Vitest node env on Node 18+). If this ever fails
    // to construct, fall back to the structural shape below.
    const err = new DOMException('Aborted', 'AbortError');
    expect(isAbortError(err)).toBe(true);
  });

  it('returns true for a plain Error with name = "AbortError"', () => {
    const err = new Error('operation aborted');
    err.name = 'AbortError';
    expect(isAbortError(err)).toBe(true);
  });

  it('returns true for a structural object with name: "AbortError"', () => {
    // Covers any provider shim that doesn't extend Error but still
    // carries the canonical name field.
    expect(isAbortError({ name: 'AbortError', message: 'x' })).toBe(true);
  });

  it('returns true when the cause is an AbortError', () => {
    const inner = new Error('inner');
    inner.name = 'AbortError';
    const outer = new Error('fetch failed');
    (outer as unknown as { cause: unknown }).cause = inner;
    expect(isAbortError(outer)).toBe(true);
  });

  it('returns true when the signal is already aborted regardless of error', () => {
    const ctrl = new AbortController();
    ctrl.abort();
    // Non-abort error shape — the signal short-circuit wins because
    // the error is almost certainly teardown fallout.
    const err = new Error('ECONNRESET');
    expect(isAbortError(err, ctrl.signal)).toBe(true);
  });

  it('returns true when the signal is aborted even with no error', () => {
    const ctrl = new AbortController();
    ctrl.abort();
    expect(isAbortError(null, ctrl.signal)).toBe(true);
    expect(isAbortError(undefined, ctrl.signal)).toBe(true);
  });

  it('returns false for a non-abort Error (real transport failure)', () => {
    // This is the critical safety case — a provider 500 or network
    // blip must still be retriable. If this flips to true, the
    // orchestrator's self-correction path dies silently.
    const err = new Error('HTTP 500');
    expect(isAbortError(err)).toBe(false);
  });

  it('returns false for null / undefined with no signal', () => {
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
  });

  it('returns false for a non-aborted signal paired with a non-abort error', () => {
    const ctrl = new AbortController();
    expect(isAbortError(new Error('HTTP 429'), ctrl.signal)).toBe(false);
  });

  it('does not loop on self-referential cause chains', () => {
    // Defensive: the predicate only peels ONE level of `.cause` —
    // a cycle must not cause infinite recursion.
    const err: { name: string; cause?: unknown } = { name: 'SomeOtherError' };
    err.cause = err;
    expect(isAbortError(err)).toBe(false);
  });
});
