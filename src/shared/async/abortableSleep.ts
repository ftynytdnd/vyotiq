/**
 * `abortableSleep` — a `setTimeout`-backed delay that settles early (by
 * rejecting with an `AbortError`) when the supplied `AbortSignal`
 * fires.
 *
 * Both the orchestrator's exponential backoff (`orchestrator/retry.ts`)
 * and the provider rate guard's gate-wide cooldown
 * (`providers/providerRateGuard.ts`) need the exact same primitive: a
 * cancellable wait that (a) never leaks the timer and (b) never leaks
 * the abort listener regardless of which path settles first. They had
 * byte-identical private copies; this is the single source.
 *
 * Cleanup contract: whichever of {timer fires, signal aborts} happens
 * first runs `cleanup()`, which clears the timer AND removes the abort
 * listener. The `{ once: true }` listener registration is belt-and-
 * suspenders on top of that — an always-on desktop agent issues these
 * waits on every retry/cooldown, so a leaked listener per wait would
 * accumulate on long-lived run signals.
 */

export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const t = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = (): void => {
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const cleanup = (): void => {
      clearTimeout(t);
      signal?.removeEventListener('abort', onAbort);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
