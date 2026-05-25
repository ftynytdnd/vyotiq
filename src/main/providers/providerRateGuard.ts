/**
 * Per-provider adaptive rate guard.
 *
 * Problem this solves
 * -------------------
 * The orchestrator's parallel sub-agent pool can fire several `streamChat`
 * calls against the same provider in the same millisecond (the default
 * cap is `MAX_PARALLEL_SUBAGENTS = 4`). Cloud-hosted providers like
 * Ollama Cloud reject the second-and-onwards request with HTTP 429
 * (`{"error":"too many concurrent requests"}`). Each worker then enters
 * its own three-strike retry budget, but because the workers back off
 * INDEPENDENTLY they all collide again on the next retry — the
 * thundering-herd pattern. The visible symptom (see screenshot §1) is
 * one or more sub-agents flipping straight to `Failed` while their
 * peers are still streaming.
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
 *     the second-and-third sibling sub-agents in a pool naturally
 *     stagger their retries instead of dog-piling.
 *
 * The guard is process-singleton; sufficient for an Electron main
 * process where every provider call is dispatched through
 * `providers/chatClient.ts`.
 */

import { BASE_BACKOFF_MS, MAX_BACKOFF_MS } from '@shared/constants.js';
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
 * Per-provider burst stagger state.
 *
 * When multiple sub-agents call `acquire()` within `BURST_WINDOW_MS` of
 * each other (a concurrent burst from `runSubAgentPool`), each successive
 * caller claims the next time slot and sleeps `BURST_SLOT_MS` longer than
 * its predecessor before making its HTTP request. This staggers the initial
 * salvo naturally in Node's single-threaded turn so workers never all fire
 * simultaneously on the first round — the root cause of the Mistral
 * thundering-herd 429 pattern visible in vyotiq.log.
 *
 * Semantics:
 *   - `nextGrantAt`: wall-clock ms of the next available stagger slot.
 *     Incremented atomically (no await between read and write) for each
 *     caller that finds an active burst window.
 *   - A burst window is "active" while the last grant was within
 *     `BURST_WINDOW_MS` ms. After that gap the state is stale; the next
 *     caller resets it and proceeds without stagger.
 *
 * The burst stagger is ONLY applied after any existing cooldown sleep so a
 * recovery from 429 does not layer a stagger on top of an already-long wait.
 */
interface BurstState {
  nextGrantAt: number;
  lastActivityAt: number;
}

const bursts = new Map<string, BurstState>();

/**
 * How closely-spaced (ms) `acquire()` calls must be to be considered
 * part of the same burst. Generous enough that 8 sub-agents launched in
 * one pool invocation all register as a burst even on a loaded main thread.
 */
const BURST_WINDOW_MS = 800;

/**
 * Per-slot stagger gap (ms). A pool of 8 workers spreads over 700 ms
 * (0, 100, 200, … 700) — comfortably below the typical Mistral 1 s
 * rate-limit window so the tail workers still complete well within the
 * sub-agent timeout budget. Kept short enough to not measurably inflate
 * overall run time on healthy providers.
 */
const BURST_SLOT_MS = 100;

/**
 * Block until `providerId`'s cooldown (if any) has expired, then apply
 * a burst stagger when concurrent sub-agent calls arrive within
 * `BURST_WINDOW_MS` of each other. Resolves immediately for isolated,
 * non-bursty requests against a healthy provider.
 */
export async function acquire(providerId: string, signal?: AbortSignal): Promise<void> {
  const state = cooldowns.get(providerId);
  if (state) {
    const now = Date.now();
    const wait = state.deadline - now;
    if (wait <= 0) {
      // Stale entry — clear so the map doesn't leak hot providers across
      // a long-running session. We do NOT touch `lastAttempt`: a fresh
      // 429 within the next iteration block should still feed the
      // exponential ladder rather than reset to 0.
      cooldowns.delete(providerId);
    } else {
      log.debug('cooldown wait', { providerId, waitMs: wait });
      await sleep(wait, signal);
    }
  }

  // Burst stagger — applied AFTER any cooldown sleep so the stagger is
  // relative to when each worker is actually ready to fire, not when
  // they all woke from the same cooldown deadline.
  //
  // All map operations below execute without any `await` between them,
  // which in Node.js's single-threaded event loop means they are
  // effectively atomic — no other `acquire` call can interleave
  // between the `get` and the `set`.
  const now2 = Date.now();
  const burst = bursts.get(providerId);
  if (!burst || now2 - burst.lastActivityAt > BURST_WINDOW_MS) {
    // No active burst or the burst window has long expired. This is the
    // first arrival (or a lone non-bursty request) — claim slot 0 with
    // no stagger and open a fresh burst window for any siblings that
    // follow within BURST_WINDOW_MS.
    bursts.set(providerId, { nextGrantAt: now2 + BURST_SLOT_MS, lastActivityAt: now2 });
  } else {
    // A burst is in progress. Claim the next slot and sleep until it.
    // `nextGrantAt` is updated synchronously so the next caller gets
    // the subsequent slot without reading a stale value.
    const mySlotAt = burst.nextGrantAt;
    burst.nextGrantAt += BURST_SLOT_MS;
    burst.lastActivityAt = now2;
    const stagger = mySlotAt - now2;
    if (stagger > 0) {
      log.debug('burst stagger', { providerId, staggerMs: stagger });
      await sleep(stagger, signal);
    }
  }
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
  bursts.clear();
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

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const t = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const cleanup = () => {
      clearTimeout(t);
      signal?.removeEventListener('abort', onAbort);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
