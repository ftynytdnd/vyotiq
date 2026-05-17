/**
 * SubAgentBriefing — top-level "briefing" panel rendered at the top
 * of every expanded sub-agent trace card.
 *
 * Three subsections, in order:
 *   1. Task            — full `task` text with copy + collapse.
 *   2. Orchestrator intent — the paragraph the orchestrator wrote
 *      immediately before emitting `<delegate />` for this worker.
 *   3. Scope           — granted tools (with one-line rationale)
 *      and files (`okFiles` inlined into the worker's context, plus
 *      `missingFiles` rendered with strikethrough as `not found`).
 *
 * Replaces the chip wall the old `SubAgentHeader` rendered. The
 * matching status strip (id, status pill, usage pill, live-status
 * shimmer, error message) continues to live in `SubAgentHeader` so
 * the trace card retains a one-line status surface above the
 * Briefing without the chip clutter — the header was slimmed down
 * but not extracted into a separate `SubAgentStatusStrip` file.
 */

import type { SubAgentSnapshot } from '../../reducer/types.js';
import { SubAgentTaskBlock } from './SubAgentTaskBlock.js';
import { SubAgentIntentQuote } from './SubAgentIntentQuote.js';
import { SubAgentScopeList } from './SubAgentScopeList.js';

interface SubAgentBriefingProps {
  snap: SubAgentSnapshot;
}

export function SubAgentBriefing({ snap }: SubAgentBriefingProps) {
  return (
    <div className="flex flex-col gap-2">
      {snap.task.trim().length > 0 && <SubAgentTaskBlock task={snap.task} />}
      <SubAgentIntentQuote subagentId={snap.id} />
      <SubAgentScopeList
        tools={snap.tools}
        okFiles={snap.files ?? []}
        missingFiles={snap.missingFiles ?? []}
      />
    </div>
  );
}
