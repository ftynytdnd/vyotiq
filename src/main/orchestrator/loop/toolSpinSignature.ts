/**
 * Hot-tool-call-signature ring buffer — observability ONLY.
 *
 * History:
 *   The previous incarnation of this module
 *   (`toolSpinDetector.ts`) carried a full nudge + halt path with two
 *   constants (`ORCHESTRATOR_SPIN_DETECT_WINDOW`,
 *   `MAX_ORCHESTRATOR_SPIN_NUDGES`) that were redundant with three
 *   already-existing mechanisms:
 *
 *     1. `toolResultCache` returns identical (name, args) reads with a
 *        prepended banner from the SECOND repeat — earlier than the
 *        spin detector's THIRD-repeat trigger.
 *     2. The harness explicitly tells the model "Don't re-survey what
 *        you've already seen" (`01-orchestration-loop.md` §B).
 *     3. `<run_state>.spin_signature_hot` exposes the recurring
 *        signature directly to the model so it can pivot before any
 *        host-side counter trips.
 *
 *   Subtraction-pass: the detector + nudge + halt was removed because
 *   the cache banner and the run-state surface together covered the
 *   exact same loop. What stayed is the buffer ITSELF — the model
 *   genuinely benefits from seeing the hot signature surfaced in
 *   `<run_state>` even without a host-side enforcement layer.
 *
 * What this module does:
 *   - Maintains a ring buffer of the last `WINDOW_SIZE` round
 *     signatures.
 *   - Returns the signature filling the window when every entry is
 *     identical, otherwise null. That value flows into
 *     `<run_state>.spin_signature_hot` so the model can self-pivot.
 *   - Provides a stable `toolCallSignature(name, args)` builder so
 *     log lines, the buffer, and any future telemetry agree on the
 *     normalization (sorted args).
 *
 * What this module does NOT do (deliberately):
 *   - No nudge counter. No halt. No three-strike-style escalation.
 *     Those are gone. If a model genuinely loops forever despite the
 *     cache banner and the run-state surface, `MAX_TOTAL_ITERATIONS`
 *     halts the run. There is no value in adding a parallel halt
 *     surface for the same condition.
 */

/**
 * Number of consecutive identical rounds that surface the signature
 * as "hot" in `<run_state>.spin_signature_hot`. Pure observability —
 * NOT a halt threshold.
 */
const WINDOW_SIZE = 3;

export interface SpinSignatureBuffer {
  /**
   * Ring buffer of the most recent collapsed round signatures, newest
   * last. Length capped at `WINDOW_SIZE`.
   */
  window: string[];
}

export function createSpinSignatureBuffer(): SpinSignatureBuffer {
  return { window: [] };
}

/**
 * Append a tool-round signature to the window. Mutates `state` in
 * place; trims the window to the configured size.
 *
 * The input is an ARRAY of signatures because a single orchestrator
 * round may include multiple tool calls. We collapse the round into
 * a single deterministic key by joining sorted signatures so two
 * calls emitted in different order compare equal — preventing a
 * model that shuffles `ls+read` ↔ `read+ls` from "moving" without
 * actually changing what it asked for.
 */
export function pushToolRound(
  state: SpinSignatureBuffer,
  signatures: readonly string[]
): void {
  if (signatures.length === 0) return;
  const key = [...signatures].sort().join('\u0001');
  state.window.push(key);
  while (state.window.length > WINDOW_SIZE) {
    state.window.shift();
  }
}

/**
 * Reset the ring buffer. Called when the loop has demonstrably made
 * progress (delegate round, substantive text, or failed tool round —
 * the last because failures are owned by the three-strike path and
 * shouldn't also surface as "hot" in the next iteration's prompt).
 */
export function resetSpinBuffer(state: SpinSignatureBuffer): void {
  state.window.length = 0;
}

/**
 * Returns the signature currently filling the window when all entries
 * are identical. Used as the value of
 * `<run_state>.spin_signature_hot`. Null when the window is mixed or
 * under-full — both signal "nothing to show the model".
 */
export function spinHotSignature(state: SpinSignatureBuffer): string | null {
  if (state.window.length < WINDOW_SIZE) return null;
  const first = state.window[0]!;
  for (let i = 1; i < state.window.length; i++) {
    if (state.window[i] !== first) return null;
  }
  return first;
}

/**
 * Convenience: build a single tool-call signature. Centralized so
 * the buffer, log lines, and any future telemetry all use the exact
 * same normalization.
 */
export function toolCallSignature(name: string, args: Record<string, unknown>): string {
  // Sort keys so `{a:1,b:2}` and `{b:2,a:1}` hash identically.
  const sortedKeys = Object.keys(args).sort();
  const stable: Record<string, unknown> = {};
  for (const k of sortedKeys) stable[k] = args[k];
  return `${name}|${JSON.stringify(stable)}`;
}
