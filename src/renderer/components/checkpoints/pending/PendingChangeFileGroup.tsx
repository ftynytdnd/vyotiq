/**
 * One file path in the pending panel — single row or collapsed stack.
 */

import { useState, type ReactNode } from 'react';
import type { PendingChange } from '@shared/types/checkpoint.js';
import { PendingChangeRow } from '../PendingChangeRow.js';
import { InlinePendingActions } from '../shared/InlinePendingActions.js';
import {
  PendingChangeAttribution,
  PendingChangePathLabel
} from '../shared/PendingChangeAttribution.js';
import { DiffStatsBadge } from '../../timeline/tools/shared/DiffStatsBadge.js';
import { PendingFileRowShell } from './PendingFileRowShell.js';
import { aggregatePendingStats } from './groupPendingByPath.js';
import { pendingPanelListClassName } from './pendingPanelStyles.js';

interface PendingChangeFileGroupProps {
  entries: readonly PendingChange[];
  virtualise: boolean;
  RowFrame: (props: { virtualise: boolean; children: ReactNode }) => ReactNode;
  diffMaxHeightClass?: string;
}

export function PendingChangeFileGroup({
  entries,
  virtualise,
  RowFrame,
  diffMaxHeightClass
}: PendingChangeFileGroupProps) {
  if (entries.length === 1) {
    return (
      <RowFrame virtualise={virtualise}>
        <PendingChangeRow
          change={entries[0]!}
          {...(diffMaxHeightClass ? { diffMaxHeightClass } : {})}
        />
      </RowFrame>
    );
  }

  return (
    <FilePathStack
      entries={entries}
      virtualise={virtualise}
      RowFrame={RowFrame}
      {...(diffMaxHeightClass ? { diffMaxHeightClass } : {})}
    />
  );
}

function FilePathStack({
  entries,
  virtualise,
  RowFrame,
  diffMaxHeightClass
}: PendingChangeFileGroupProps) {
  const [expanded, setExpanded] = useState(false);
  const head = entries[entries.length - 1]!;
  const stats = aggregatePendingStats(entries);

  return (
    <div className="vyotiq-stepfade-once group flex flex-col">
      <PendingFileRowShell
        expanded={expanded}
        onToggleExpand={() => setExpanded((v) => !v)}
        path={
          <>
            <PendingChangePathLabel change={head} stackCount={entries.length} />
            <PendingChangeAttribution change={head} />
          </>
        }
        stats={
          <DiffStatsBadge
            additions={stats.additions}
            deletions={stats.deletions}
            minWidth="badge"
          />
        }
        actions={
          <InlinePendingActions
            changes={entries}
            hoverGated
            showOpen
            compact
          />
        }
      />
      {expanded && (
        <div className={pendingPanelListClassName}>
          {entries.map((entry, index) => (
            <RowFrame key={entry.entryId} virtualise={virtualise}>
              <PendingChangeRow
                change={entry}
                nested
                index={index + 1}
                total={entries.length}
                {...(diffMaxHeightClass ? { diffMaxHeightClass } : {})}
              />
            </RowFrame>
          ))}
        </div>
      )}
    </div>
  );
}
