/**
 * Live-turn inline stream — renders agent-side rows in strict wire order
 * (prose, tools, delegates interleaved). Used for live and completed turns.
 */

import type { ReactNode } from 'react';
import type { DisplayRow } from '../shared/projectSubagentRows.js';
import {
  timelineActivityLaneClassName,
  timelineTurnInnerGapClassName
} from '../shared/rowStyles.js';
import { cn } from '../../../lib/cn.js';

interface TurnInlineStreamProps {
  rows: DisplayRow[];
  renderRow: (row: DisplayRow) => ReactNode;
  /** Append live telemetry after the inline stream when the run is active. */
}

export function TurnInlineStream({
  rows,
  renderRow
}: TurnInlineStreamProps) {
  if (rows.length === 0) return null;

  return (
    <div
      className={cn(
        timelineActivityLaneClassName,
        timelineTurnInnerGapClassName,
        // Flush assistant prose inside the live stream — no response card chrome.
        '[&_[data-row-kind=assistant-text]]:rounded-none',
        '[&_[data-row-kind=assistant-text]]:bg-transparent',
        '[&_[data-row-kind=assistant-text]]:p-0',
        '[&_[data-row-kind=assistant-text]]:py-0.5'
      )}
      data-turn-inline-stream
    >
      {rows.map((row) => (
        <div key={row.key}>{renderRow(row)}</div>
      ))}
    </div>
  );
}
