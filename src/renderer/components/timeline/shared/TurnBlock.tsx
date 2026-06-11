/**
 * TurnBlock — one user prompt and all following agent rows until the next
 * user prompt. Agent-side content renders as a single chronological stream.
 */

import { memo, type ReactNode } from 'react';
import { cn } from '../../../lib/cn.js';
import type { DisplayRow } from './displayRowTypes.js';
import type { PartitionedTurn } from './groupTurnSegment.js';
import { TurnStickyFooter } from './TurnStickyFooter.js';
import {
  timelineLiveTurnClassName,
  timelineTurnOuterGapClassName,
  timelineTurnZoneGapClassName,
  timelineAgentColumnClassName
} from './rowStyles.js';

interface TurnBlockProps {
  partitioned: PartitionedTurn;
  renderRow: (row: DisplayRow) => ReactNode;
  /** Live run — last turn while the conversation is processing. */
  live?: boolean;
  /** Animate the user prompt from the landing composer position. */
  promptAnchorEnter?: boolean;
  /** Run-complete metadata is inlined on the assistant row — tighten footer chrome. */
  compactFooter?: boolean;
  className?: string;
}

export const TurnBlock = memo(function TurnBlock({
  partitioned,
  renderRow,
  live = false,
  promptAnchorEnter = false,
  compactFooter = false,
  className
}: TurnBlockProps) {
  const { prompt, agentStream, footer } = partitioned;
  const showAgentStream = agentStream.length > 0 || live;
  const promptId = prompt?.kind === 'user-prompt' ? prompt.id : undefined;

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
      {prompt && (
        <div
          className={cn(promptAnchorEnter && 'vyotiq-prompt-anchor-enter')}
          data-prompt-anchor={promptAnchorEnter ? '' : undefined}
        >
          {renderRow(prompt)}
        </div>
      )}

      <div className={timelineAgentColumnClassName}>
        {showAgentStream &&
          agentStream.map((row) => (
            <div key={row.key}>{renderRow(row)}</div>
          ))}

        {(live || footer.length > 0) && (
          <TurnStickyFooter live={live} promptId={promptId} compact={compactFooter}>
            {footer.map((row) => {
              const content = renderRow(row);
              if (!content) return null;
              return <div key={row.key}>{content}</div>;
            })}
          </TurnStickyFooter>
        )}
      </div>
    </div>
  );
});

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
