/**
 * SubAgentBriefing — task + scope for an expanded sub-agent trace.
 * Renders only the per-worker briefing (task + granted tools + scoped
 * files); the orchestrator-level delegate roster used to live in a
 * separate stepper row (`OrchestratorExecutionPlanRow`) but was
 * removed because the `DelegateBatchRow` immediately above already
 * lists every worker spawned in the same turn.
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { SubAgentSnapshot } from '../../../timeline/reducer/types.js';
import { SubAgentTaskBlock } from './SubAgentTaskBlock.js';
import { SubAgentScopeList } from './SubAgentScopeList.js';
import { cn } from '../../../../lib/cn.js';
import {
  timelineRowChevronClassName,
  timelineRowHeaderClassName
} from '../../../timeline/shared/rowStyles.js';

interface SubAgentBriefingProps {
  snap: SubAgentSnapshot;
  /** When true, briefing starts collapsed behind a toggle. */
  defaultCollapsed?: boolean;
}

export function SubAgentBriefing({ snap, defaultCollapsed = false }: SubAgentBriefingProps) {
  const [expanded, setExpanded] = useState(!defaultCollapsed);

  const hasTask = snap.task.trim().length > 0;
  const hasScope =
    snap.tools.length > 0 ||
    (snap.unknownTools?.length ?? 0) > 0 ||
    (snap.files?.length ?? 0) > 0 ||
    (snap.missingFiles?.length ?? 0) > 0;

  if (!hasTask && !hasScope) {
    return null;
  }

  const body = (
    <div className="flex flex-col gap-2">
      {hasTask && <SubAgentTaskBlock task={snap.task} />}
      <SubAgentScopeList
        tools={snap.tools}
        unknownTools={snap.unknownTools ?? []}
        okFiles={snap.files ?? []}
        missingFiles={snap.missingFiles ?? []}
      />
    </div>
  );

  if (!defaultCollapsed) {
    return body;
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className={cn(timelineRowHeaderClassName, 'rounded-inner hover:bg-surface-hover/30')}
      >
        {expanded ? (
          <ChevronDown className={timelineRowChevronClassName} strokeWidth={2} />
        ) : (
          <ChevronRight className={timelineRowChevronClassName} strokeWidth={2} />
        )}
        <span className="text-row font-medium text-text-secondary">Briefing</span>
      </button>
      {expanded && body}
    </div>
  );
}
