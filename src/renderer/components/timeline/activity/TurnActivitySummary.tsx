/**

 * TurnActivitySummary — compact orchestrator progress (~5 steps) in the

 * activity lane during live turns; one collapsed line after the run settles.

 */



import { useMemo, useState } from 'react';

import { ChevronDown } from 'lucide-react';

import type { DisplayRow } from '../shared/projectSubagentRows.js';

import { useChatStore } from '../../../store/useChatStore.js';

import { cn } from '../../../lib/cn.js';

import {

  resolveLivePhaseHeadline,

  timelineActivityLaneClassName,

  timelinePhaseHeadingClassName

} from '../shared/rowStyles.js';

import { shimmerText } from '../../../lib/shimmer.js';

import { SHELL_MICRO_ICON_CLASS, SHELL_MICRO_ICON_STROKE } from '../../../lib/shellIcons.js';



const VISIBLE_STEPS = 5;



interface TurnActivitySummaryProps {

  activityRows: DisplayRow[];

  live?: boolean;

}



function stepLabelFromRow(row: DisplayRow): string | null {

  if (row.kind === 'agent-thought') {

    const t = row.content.trim();

    return t.length > 0 ? t.slice(0, 120) : null;

  }

  if (row.kind === 'delegate-batch') {

    const n = row.subagentIds?.length ?? 0;

    return n > 0 ? `Delegated ${n} sub-agent${n === 1 ? '' : 's'}` : 'Delegating…';

  }

  if (row.kind === 'subagent-line') {

    return 'Sub-agent running…';

  }

  return null;

}



export function TurnActivitySummary({ activityRows, live = false }: TurnActivitySummaryProps) {

  const [expanded, setExpanded] = useState(false);

  const latestStatus = useChatStore((s) => (live ? s.latestOrchestratorRunStatus : undefined));

  const isProcessing = useChatStore((s) => s.isProcessing);



  const steps = useMemo(() => {

    const fromRows: string[] = [];

    for (const row of activityRows) {

      const label = stepLabelFromRow(row);

      if (label) fromRows.push(label);

    }

    if (live && latestStatus) {

      const liveLabel = resolveLivePhaseHeadline(

        latestStatus.phase,

        latestStatus.label ?? 'Working…'

      );

      if (fromRows[fromRows.length - 1] !== liveLabel) {

        fromRows.push(liveLabel);

      }

    }

    return fromRows;

  }, [activityRows, live, latestStatus]);



  if (!live && steps.length === 0) return null;

  if (live && !isProcessing && steps.length === 0) return null;



  const collapsedLine =

    steps.length === 1

      ? steps[0]!

      : `${steps.length} steps · ${steps[steps.length - 1]!}`;



  if (!live && !expanded) {

    return (

      <div

        className={cn(timelineActivityLaneClassName, 'vyotiq-stepfade-once')}

        data-turn-activity-summary

      >

        <button

          type="button"

          onClick={() => setExpanded(true)}

          className="vx-btn vx-btn-quiet inline-flex w-full min-w-0 items-center gap-1 px-0.5 py-0 text-left text-meta text-text-muted"

          aria-expanded={false}

        >

          <span className="min-w-0 truncate">{collapsedLine}</span>

          <ChevronDown className={cn(SHELL_MICRO_ICON_CLASS, 'shrink-0')} strokeWidth={SHELL_MICRO_ICON_STROKE} />

        </button>

      </div>

    );

  }



  const visible = expanded || live ? (expanded ? steps : steps.slice(-VISIBLE_STEPS)) : steps;

  const hiddenCount = steps.length - visible.length;



  return (

    <div

      className={cn(timelineActivityLaneClassName, 'vyotiq-stepfade-once')}

      data-turn-activity-summary

      aria-live={live ? 'polite' : undefined}

    >

      <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-meta text-text-muted">

        {hiddenCount > 0 && !expanded && live && (

          <li className="px-0.5 text-text-faint">+{hiddenCount} earlier</li>

        )}

        {visible.map((label, i) => {

          const isLast = i === visible.length - 1;

          const shimmer = live && isLast && isProcessing;

          return (

            <li

              key={`${i}-${label.slice(0, 24)}`}

              className={cn(

                'truncate px-0.5',

                isLast && live && timelinePhaseHeadingClassName(true)

              )}

            >

              <span className={cn(shimmerText(shimmer))}>{label}</span>

            </li>

          );

        })}

      </ul>

      {(steps.length > VISIBLE_STEPS || !live) && (

        <button

          type="button"

          onClick={() => setExpanded((v) => !v)}

          className="vx-btn vx-btn-quiet mt-1 inline-flex items-center gap-0.5 px-1 py-0 text-meta text-text-faint"

        >

          {expanded ? 'Show less' : live ? `Show all (${steps.length})` : 'Collapse'}

          <ChevronDown

            className={cn(SHELL_MICRO_ICON_CLASS, expanded && 'rotate-180')}

            strokeWidth={SHELL_MICRO_ICON_STROKE}

          />

        </button>

      )}

    </div>

  );

}


