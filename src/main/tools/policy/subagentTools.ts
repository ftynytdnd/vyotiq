/**
 * Sub-agent tool policy.
 *
 * Sub-agents are ephemeral, single-task workers spawned by the orchestrator.
 * Each receives a fresh blank context window and a restricted tool allowlist
 * tuned to its specific micro-task.
 *
 *   - `SUBAGENT_DEFAULT_TOOLS` is the read-only allowlist used when a
 *     `delegate` call omits the `tools` argument.
 *
 *   - `SUBAGENT_FULL_TOOLS` is the upper bound — the orchestrator may opt
 *     into any subset via `delegate({ tools: ["bash","edit"] })`.
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
 *  `00-orchestrator-core.md`. The orchestrator never sees it in its
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
 * Detailed validation result. Carries both the resolved allowlist
 * (`allowed`) AND the names that were silently dropped (`dropped`),
 * so callers can surface a `phase` event / spawn-card chip telling
 * the user (and the model) that the directive's `tools=` attribute
 * contained a typo or an out-of-set name. Review finding H10 — the
 * legacy filter dropped unknowns silently and the orchestrator never
 * learned about it.
 *
 * `defaulted: true` indicates the requested list was empty / had no
 * survivors and the read-only default kicked in. The renderer can
 * use this to surface a softer "no tools requested → defaulted to
 * read-only" hint instead of a "tools dropped" warning.
 */
export interface ValidatedToolset {
  allowed: ToolName[];
  dropped: string[];
  defaulted: boolean;
}

/**
 * Detailed variant of `validateSubagentToolset` that surfaces the
 * dropped names. Production callers (handleDelegates) use this so
 * they can emit a `phase` event and populate
 * `subagent-spawn.unknownTools` for the renderer's chip surface.
 */
export function validateSubagentToolsetDetailed(
  requested: readonly string[] | undefined
): ValidatedToolset {
  if (!requested || requested.length === 0) {
    return {
      allowed: [...SUBAGENT_DEFAULT_TOOLS],
      dropped: [],
      defaulted: true
    };
  }
  const allow = new Set<string>(SUBAGENT_FULL_TOOLS);
  const allowed: ToolName[] = [];
  const dropped: string[] = [];
  for (const t of requested) {
    if (allow.has(t)) {
      allowed.push(t as ToolName);
    } else {
      if (typeof t === 'string' && t.length > 0) dropped.push(t);
    }
  }
  if (allowed.length === 0) {
    return {
      allowed: [...SUBAGENT_DEFAULT_TOOLS],
      dropped,
      defaulted: true
    };
  }
  return { allowed, dropped, defaulted: false };
}

/**
 * Resolves an opt-in `tools` list from a `<delegate>` directive against the
 * sub-agent capability whitelist. Unknown / disallowed tool names are
 * filtered out silently — the sub-agent will simply not see them. If the
 * resulting list is empty (e.g. the directive omitted `tools` entirely),
 * the read-only default is returned.
 *
 * Backward-compatible thin wrapper around `validateSubagentToolsetDetailed`
 * (review finding H10) — call sites that don't need the dropped-name
 * surface keep their existing signature.
 */
export function validateSubagentToolset(requested: readonly string[] | undefined): ToolName[] {
  return validateSubagentToolsetDetailed(requested).allowed;
}
