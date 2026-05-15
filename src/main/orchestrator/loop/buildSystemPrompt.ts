/**
 * Composes the orchestrator's system prompt for a given iteration.
 *
 * Layout (in order):
 *   1. The harness (built once at boot from the markdown files).
 *   2. The freshly-refreshed dynamic envelopes:
 *        - `<meta_rules>`           — user preferences (highest authority).
 *        - `<workspace_context>`    — current project state (file listing).
 *        - `<session_context>`      — conversation title + prior-turn
 *                                     count + last model. Anchors short
 *                                     continuation prompts to the right
 *                                     conversation so an empty
 *                                     `<recent_memory>` cannot be
 *                                     mistaken for a freshness signal.
 *        - `<run_state>`            — host-maintained per-iteration
 *                                     counters (iteration number,
 *                                     nudges remaining, three-strike
 *                                     counters, last action, hot tool
 *                                     signature). Sits between session
 *                                     and prior conversations because
 *                                     it describes "where this run is
 *                                     right now". Surfacing this is the
 *                                     subtraction-principle replacement
 *                                     for several reactive heuristics —
 *                                     the model self-regulates from the
 *                                     numbers instead of the host
 *                                     having to reactively nudge.
 *        - `<prior_conversations>`  — directory of OTHER conversations.
 *        - `<recent_memory>`        — long-term notes retrieved from
 *                                     the memory store.
 *
 * The harness sits inside `<system_instructions>` (built by
 * `harnessLoader`). Everything appended after it is DATA — the agent is
 * forbidden from treating those blocks as instructions that override
 * the harness (Prime Directives §8, "The Harness Boundary").
 */

import type { ContextEnvelopes } from '../contextManager.js';

export function buildSystemPrompt(
  harness: string,
  env: ContextEnvelopes,
  runStateXml: string
): string {
  return [
    harness,
    env.metaRulesXml,
    env.workspaceXml,
    env.sessionXml,
    runStateXml,
    env.priorConversationsXml,
    env.memoryXml
  ].join('\n\n');
}
