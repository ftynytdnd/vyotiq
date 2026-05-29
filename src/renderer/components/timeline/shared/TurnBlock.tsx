/**
 * TurnBlock — one user prompt and all following agent rows until the next
 * user prompt. Agent-side content always renders as a single chronological
 * inline stream (prose, tools, delegates interleaved in wire order).
 */

import { type ReactNode } from 'react';
import { cn } from '../../../lib/cn.js';
import type { DisplayRow } from './projectSubagentRows.js';
import type { PartitionedTurn } from './groupTurnSegment.js';
import { TurnRunningMeta } from '../activity/TurnRunningMeta.js';
import { StreamWeaveStream } from '../delegation/StreamWeaveStream.js';
import {
  timelineLiveTurnClassName,
  timelineTurnOuterGapClassName,
  timelineTurnZoneGapClassName,
  timelineAgentColumnClassName,
  timelineActivityLaneClassName
} from './rowStyles.js';
import { splitContextSummaryRows } from './contextSummaryRows.js';

interface TurnBlockProps {
  partitioned: PartitionedTurn;
  renderRow: (row: DisplayRow) => ReactNode;
  /** Live run — last turn while the conversation is processing. */
  live?: boolean;
  className?: string;
}

export function TurnBlock({
  partitioned,
  renderRow,
  live = false,
  className
}: TurnBlockProps) {
  const { prompt, footer } = partitioned;
  const { contextSummaryRows, inlineStreamRows } = splitContextSummaryRows(partitioned.agentStream);
  const showAgentStream = inlineStreamRows.length > 0 || live;

  return (
    <div
      data-turn-block
      data-turn-live={live ? 'true' : undefined}
      className={cn(
        'relative flex flex-col py-0',
        timelineTurnZoneGapClassName,
        timelineTurnOuterGapClassName,
        !live && 'vyotiq-stepfade-once',
        timelineLiveTurnClassName(live),
        className
      )}
    >
      {prompt && renderRow(prompt)}

      <div className={timelineAgentColumnClassName}>
        {contextSummaryRows.map((row) => (
          <div key={row.key} className={timelineActivityLaneClassName}>
            {renderRow(row)}
          </div>
        ))}
        {showAgentStream && (
          <StreamWeaveStream rows={inlineStreamRows} renderRow={renderRow} live={live} />
        )}

        {live && footer.length === 0 && <TurnRunningMeta live={live} />}
        {footer.map((row) => (
          <div key={row.key}>{renderRow(row)}</div>
        ))}
      </div>
    </div>
  );
}

/** Split derived rows into turn segments starting at each user-prompt. */
export function groupRowsIntoTurns<T extends { kind: string }>(rows: T[]): T[][] {
  const segments: T[][] = [];
  let current: T[] = [];

  for (const row of rows) {
    if (row.kind === 'user-prompt' && current.length > 0) {
      segments.push(current);
      current = [row];
    } else {
      current.push(row);
    }
  }

  if (current.length > 0) {
    segments.push(current);
  }

  return segments;
}
