/**
 * `isAbortError` — single-source predicate for detecting user-initiated
 * cancellation at every error-handling branch in the orchestrator.
 *
 * Why centralize: `fetch`, `ReadableStream.getReader()`, and the various
 * `AsyncIterable` teardown paths all throw a mix of `DOMException` with
 * `name: 'AbortError'`, plain `Error` objects whose `.name` was set to
 * `'AbortError'`, and wrapped errors whose `.cause` carries one of the
 * above. Without a single predicate every retry branch re-implements the
 * check slightly differently — and one of them inevitably drifts into
 * counting a user's Stop as a retriable provider failure (see the
 * screenshots where "LLM call failed (attempt 1/3): This operation was
 * aborted. Retrying." lingered for seconds after the user hit Stop).
 *
 * The predicate is deliberately conservative: if the caller hands us a
 * live `AbortSignal` and it's already aborted, we return `true` even if
 * the error is something unrelated — because the run is ending anyway
 * and any accompanying error is almost certainly a downstream artifact
 * of the teardown (e.g. `ERR_ABORTED` on the SSE reader after the signal
 * fired). Treating it as a clean abort avoids emitting a phantom retry
 * notice on the way out.
 */

export function isAbortError(err: unknown, signal?: AbortSignal): boolean {
  // If the run-scoped signal has already fired, the error is
  // overwhelmingly likely to be teardown fallout — short-circuit true.
  if (signal?.aborted === true) return true;

  if (err === null || err === undefined) return false;

  // DOMException / plain Error / anything that stringifies `name`.
  // Using `(err as { name?: unknown }).name` keeps the predicate
  // structural so mocks in tests can exercise the branch without
  // constructing a real DOMException (which isn't available in the
  // node test environment on older targets).
  const name = (err as { name?: unknown }).name;
  if (typeof name === 'string' && name === 'AbortError') return true;

  // Some providers' fetch shims (e.g. undici in older Electron) wrap
  // the abort as `{ cause: DOMException('AbortError') }`. Peel one
  // level so the caller doesn't have to do it in every branch.
  const cause = (err as { cause?: unknown }).cause;
  if (cause && cause !== err) {
    const causeName = (cause as { name?: unknown }).name;
    if (typeof causeName === 'string' && causeName === 'AbortError') return true;
  }

  return false;
}
