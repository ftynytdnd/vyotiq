/**
 * Per-provider adaptive rate guard.
 *
 * Problem this solves
 * -------------------
 * The orchestrator can fire several `streamChat` calls against the same
 * provider in the same millisecond (parallel tool batches or concurrent
 * runs). Cloud-hosted providers like Ollama Cloud reject the
 * second-and-onwards request with HTTP 429
 * (`{"error":"too many concurrent requests"}`). Each caller then enters
 * its own three-strike retry budget, but because callers back off
 * INDEPENDENTLY they all collide again on the next retry — the
 * thundering-herd pattern. The visible symptom is concurrent runs
 * flipping straight to `Failed` while their peers are still streaming.
 *
 * What this guard does
 * --------------------
 * Tracks a per-`providerId` cooldown deadline. When a transport call
 * receives a 429 (or any error the runtime wants to back off from),
 * `markRateLimited` records a deadline derived from the call's retry
 * attempt — jittered exponential, capped at `MAX_BACKOFF_MS`. Subsequent
 * `acquire` calls for the same provider sleep until that deadline
 * before issuing their fetch. Successful responses clear any stored
 * deadline via `markSuccess`.
 *
 * The guard is INTENTIONALLY ADAPTIVE only:
 *   - No fixed concurrency cap. Healthy providers see no slowdown.
 *   - No model-id validation. Unknown models surface as the provider's
 *     own 400/404 response with the body summary intact.
 *   - Cooldown is shared across ALL workers for a given provider, so
 *     sibling concurrent streams in a pool naturally
 *     stagger their retries instead of dog-piling.
 *
 * The guard is process-singleton; sufficient for an Electron main
 * process where every provider call is dispatched through
 * `providers/chatClient.ts`.
 */

import { BASE_BACKOFF_MS, MAX_BACKOFF_MS } from '@shared/constants.js';
import { abortableSleep } from '@shared/async/abortableSleep.js';
import { logger } from '../logging/logger.js';

const log = logger.child('providers/rate-guard');

interface CooldownState {
  /** Wall-clock ms after which the provider is considered ready again. */
  deadline: number;
  /** Last attempt index used to compute the cooldown duration. */
  lastAttempt: number;
}

const cooldowns = new Map<string, CooldownState>();

/**
 * Block until `providerId`'s cooldown (if any) has expired. Proactive
 * burst stagger was removed; reactive 429 backoff remains.
 */
export async function acquire(providerId: string, signal?: AbortSignal): Promise<void> {
  const state = cooldowns.get(providerId);
  if (!state) return;
  const now = Date.now();
  const wait = state.deadline - now;
  if (wait <= 0) {
    cooldowns.delete(providerId);
    return;
  }
  log.debug('cooldown wait', { providerId, waitMs: wait });
  await abortableSleep(wait, signal);
}

/**
 * Record that `providerId` returned 429 (or another back-off-worthy
 * error). The next `acquire` call against this provider will sleep
 * until the computed deadline.
 *
 * `attempt` is a HINT — when omitted (the common transport-level call
 * site that has no per-worker counter to thread through) the gate
 * auto-escalates based on how recently a previous mark landed. Two
 * 429s observed within a single cooldown window count as "we tried
 * once and the provider is still saturated", so the next cooldown
 * doubles. After a clean window (cooldown expired before another
 * mark arrived) the escalation resets to attempt=1.
 *
 * If a deadline is already set and is FURTHER in the future than the
 * one this call would compute, it is preserved — a faster sibling
 * worker that already absorbed the 429 should not have its cooldown
 * shortened by a slower sibling that just observed the same condition.
 */
export function markRateLimited(providerId: string, attempt?: number): void {
  const existing = cooldowns.get(providerId);
  // Auto-escalation: another mark arriving while we are STILL in the
  // last cooldown window is evidence that the provider is genuinely
  // saturated (not just an unlucky single-flight blip), so step the
  // attempt counter up. A clean window with no marks has already
  // pruned `existing` via `acquire()`, so the next mark naturally
  // restarts at attempt=1.
  const effectiveAttempt =
    typeof attempt === 'number' && attempt > 0
      ? attempt
      : existing
        ? Math.min(existing.lastAttempt + 1, MAX_ATTEMPT)
        : 1;
  const wait = computeBackoff(effectiveAttempt);
  const candidate = Date.now() + wait;
  if (existing && existing.deadline >= candidate) return;
  cooldowns.set(providerId, {
    deadline: candidate,
    lastAttempt: Math.max(effectiveAttempt, existing?.lastAttempt ?? 0)
  });
  log.debug('cooldown set', { providerId, attempt: effectiveAttempt, waitMs: wait });
}

/**
 * Cap on the attempt counter used by `computeBackoff`. Mirrors the
 * `MAX_BACKOFF_MS` ceiling — past this point, doubling the attempt
 * adds nothing because `Math.min` already clamps the result.
 */
const MAX_ATTEMPT = 8;

/**
 * Clear any cooldown for `providerId`. Called by the transport on a
 * successful response so the next request through the gate is
 * unimpeded. No-ops when no cooldown was ever recorded.
 */
export function markSuccess(providerId: string): void {
  if (cooldowns.delete(providerId)) {
    log.debug('cooldown cleared', { providerId });
  }
}

/**
 * Test-only helper. Drops every recorded cooldown and burst state — used
 * by the vitest suite so each test starts from a clean gate.
 */
export function _resetForTests(): void {
  cooldowns.clear();
}

function computeBackoff(attempt: number): number {
  const raw = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * Math.pow(2, attempt));
  // 25 % jitter, matching `orchestrator/retry.ts:backoff` so the
  // worker-local backoff and the gate-wide cooldown stay in the same
  // visible distribution. Jitter is positive only — never undershoots
  // the deterministic exponential — so siblings naturally stagger.
  const jitter = Math.random() * 0.25 * raw;
  return Math.max(0, raw + jitter);
}
