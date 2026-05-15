/**
 * Sub-agent tool policy.
 *
 * Sub-agents are ephemeral, single-task workers spawned by the orchestrator.
 * Each receives a fresh blank context window and a restricted tool allowlist
 * tuned to its specific micro-task.
 *
 *   - `SUBAGENT_DEFAULT_TOOLS` is the read-only allowlist used when the
 *     `<delegate ... />` directive does not specify a `tools` attribute.
 *
 *   - `SUBAGENT_FULL_TOOLS` is the upper bound — the orchestrator may opt
 *     into any subset by listing them in `<delegate tools="bash,edit" />`.
 *     Anything outside this set is rejected by `validateSubagentToolset`.
 */

import type { ToolName } from '@shared/types/tool.js';

/** Read-only allowlist used when a delegate directive omits `tools`.
 *  `report` is intentionally absent — it is a file write, and
 *  forcing the orchestrator to opt in keeps the read-only default
 *  actually read-only. */
const SUBAGENT_DEFAULT_TOOLS: readonly ToolName[] = [
  'read',
  'ls',
  'search'
] as const;

/** Upper bound on sub-agent capabilities. The orchestrator may opt in to any
 *  subset; capabilities outside this list are rejected.
 *
 *  `report` is in this set so a delegate with `tools="report"` can
 *  author HTML artifacts. It is deliberately delegate-only — heavy
 *  authoring work always goes through delegation per
 *  `00-prime-directives.md`. The orchestrator never sees it in its
 *  function-calling schema. */
const SUBAGENT_FULL_TOOLS: readonly ToolName[] = [
  'bash',
  'edit',
  'delete',
  'read',
  'ls',
  'search',
  'memory',
  'report'
] as const;

/**
 * Resolves an opt-in `tools` list from a `<delegate>` directive against the
 * sub-agent capability whitelist. Unknown / disallowed tool names are
 * filtered out silently — the sub-agent will simply not see them. If the
 * resulting list is empty (e.g. the directive omitted `tools` entirely),
 * the read-only default is returned.
 */
export function validateSubagentToolset(requested: readonly string[] | undefined): ToolName[] {
  if (!requested || requested.length === 0) {
    return [...SUBAGENT_DEFAULT_TOOLS];
  }
  const allow = new Set<string>(SUBAGENT_FULL_TOOLS);
  const filtered = requested.filter((t) => allow.has(t)) as ToolName[];
  return filtered.length > 0 ? filtered : [...SUBAGENT_DEFAULT_TOOLS];
}
