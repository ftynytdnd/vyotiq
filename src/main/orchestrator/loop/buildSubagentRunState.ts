/**
 * Builds the `<run_state>` envelope for an ephemeral sub-agent.
 *
 * Mirrors the orchestrator-side `buildRunState.ts` but trimmed to the
 * tiny surface a single worker can act on:
 *
 *   - Where am I in the iteration budget? (`iteration` / `cap`)
 *   - What did I just do? (`last_action`)
 *   - What tools may I call? (`allowed_tools`)
 *   - Have I burned any of my self-correction budget? (`attempt`)
 *   - Is this the wrap-up turn where the host has forced
 *     `tool_choice: 'none'`? (`wrap_up_pending`)
 *
 * The orchestrator's run_state surfaces totals across delegate / direct-
 * tool rounds, nudges, and spin signatures — none of those concepts
 * exist for a sub-agent (it has no nested workers, no nudge budget, and
 * its own loop is short). Keeping the worker's view minimal honors the
 * Stanford "subtraction principle": give the model only the numbers it
 * can change.
 *
 * Cost: 5–6 short lines of text per iteration, well under 30 tokens.
 * The envelope is rebuilt each iteration and embedded inside the
 * sub-agent's `<system_instructions>` (NOT as a peer) so it sits in
 * the trusted instruction plane and cannot be confused with sub-agent
 * tool output.
 */

import { wrapXml } from '../envelope/index.js';
import {
  MAX_SELF_CORRECTION_ATTEMPTS,
  SUBAGENT_MAX_ITERATIONS
} from '@shared/constants.js';

/**
 * Last meaningful action the worker performed. Mirrors the iteration
 * branches in `SubAgent.ts:runSubAgent` so the model sees a coherent
 * trail rather than having to infer it from the message history.
 *
 *   - `none`                 — first iteration, nothing has happened yet.
 *   - `tool-round:ok`        — at least one tool call ran successfully.
 *   - `tool-round:failed`    — a tool round ran and ALL calls failed.
 *   - `retry`                — provider transport error triggered backoff.
 *   - `refused-by-allowlist` — model tried a tool outside its allowlist.
 *   - `text-no-result`       — model emitted final prose but skipped the
 *                              `<result>…</result>` wrap. The host gives
 *                              the worker EXACTLY ONE recovery turn to
 *                              re-emit the same content inside the
 *                              envelope before declaring `'malformed'`.
 *                              See `SubAgent.ts:textNoResultRetries` for
 *                              the budget.
 */
export type SubagentLastAction =
  | 'none'
  | 'tool-round:ok'
  | 'tool-round:failed'
  | 'retry'
  | 'refused-by-allowlist'
  | 'text-no-result';

export interface SubagentRunStateView {
  /** Zero-indexed iteration the worker is ABOUT to enter. */
  iteration: number;
  /** Tool names the worker may call this turn. */
  allowedTools: readonly string[];
  /** Last transition. `'none'` on iteration 0. */
  lastAction: SubagentLastAction;
  /** Consecutive provider failures within this sub-agent's lifetime. */
  consecutiveErrors: number;
  /**
   * True when the host has forced `tool_choice: 'none'` for the
   * NEXT provider request — the worker must emit prose (the
   * `<result>` envelope) instead of more tool calls. Surfacing this
   * makes the wrap-up enforceable at the prompt level too: the model
   * sees the constraint and knows why its tool choice will be denied.
   */
  wrapUpPending: boolean;
}

/**
 * Render the view as an XML envelope. Stable layout — same key order
 * every iteration — so the model can pattern-match it.
 */
export function buildSubagentRunStateXml(view: SubagentRunStateView): string {
  const lines: string[] = [
    `iteration: ${view.iteration} of ${SUBAGENT_MAX_ITERATIONS}`,
    `allowed_tools: ${view.allowedTools.length > 0 ? view.allowedTools.join(',') : '(none)'}`,
    `last_action: ${view.lastAction}`,
    `consecutive_errors: ${view.consecutiveErrors} of ${MAX_SELF_CORRECTION_ATTEMPTS}`,
    `wrap_up_pending: ${view.wrapUpPending ? 'true' : 'false'}`
  ];
  if (view.wrapUpPending) {
    // One-line guidance the model can act on immediately. Kept short
    // so the envelope cost stays bounded; the harness's
    // `02-subagent-prompt.md` has the long-form rationale.
    lines.push(
      `# Wrap-up: tool calls are disabled for this turn — emit your <result>…</result> envelope now.`
    );
  }
  return wrapXml('run_state', lines.join('\n'));
}
