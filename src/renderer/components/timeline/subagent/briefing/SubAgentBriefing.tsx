/**
 * SubAgentBriefing — collapsible briefing section for sub-agent detail.
 *
 * Three subsections when expanded:
 *   1. Task
 *   2. Orchestrator intent
 *   3. Scope (tools + files)
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { SubAgentSnapshot } from '../../reducer/types.js';
import { SubAgentTaskBlock } from './SubAgentTaskBlock.js';
import { SubAgentIntentQuote } from './SubAgentIntentQuote.js';
import { SubAgentScopeList } from './SubAgentScopeList.js';
import { cn } from '../../../../lib/cn.js';
import {
  timelineRowChevronClassName,
  timelineRowHeaderClassName
} from '../../shared/rowStyles.js';

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
    (snap.files?.length ?? 0) > 0 ||
    (snap.missingFiles?.length ?? 0) > 0;

  if (!hasTask && !hasScope) {
    return <SubAgentIntentQuote subagentId={snap.id} />;
  }

  const body = (
    <div className="flex flex-col gap-2">
      {hasTask && <SubAgentTaskBlock task={snap.task} />}
      <SubAgentIntentQuote subagentId={snap.id} />
      <SubAgentScopeList
        tools={snap.tools}
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
