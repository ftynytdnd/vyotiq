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
import type { ReviewLinePickProps } from '../../timeline/tools/edit/diff/diffLinePick.js';

interface PendingChangeFileGroupProps {
  entries: readonly PendingChange[];
  virtualise: boolean;
  RowFrame: (props: { virtualise: boolean; children: ReactNode }) => ReactNode;
  reviewMode?: boolean;
  diffMaxHeightClass?: string;
  linePick?: ReviewLinePickProps;
}

export function PendingChangeFileGroup({
  entries,
  virtualise,
  RowFrame,
  reviewMode = false,
  diffMaxHeightClass,
  linePick
}: PendingChangeFileGroupProps) {
  if (entries.length === 1) {
    return (
      <RowFrame virtualise={virtualise}>
        <PendingChangeRow
          change={entries[0]!}
          alwaysExpanded={reviewMode}
          {...(diffMaxHeightClass ? { diffMaxHeightClass } : {})}
          {...(linePick ? { linePick } : {})}
        />
      </RowFrame>
    );
  }

  return (
    <FilePathStack
      entries={entries}
      virtualise={virtualise}
      RowFrame={RowFrame}
      reviewMode={reviewMode}
      {...(diffMaxHeightClass ? { diffMaxHeightClass } : {})}
      {...(linePick ? { linePick } : {})}
    />
  );
}

function FilePathStack({
  entries,
  virtualise,
  RowFrame,
  reviewMode = false,
  diffMaxHeightClass,
  linePick
}: PendingChangeFileGroupProps) {
  const [expanded, setExpanded] = useState(reviewMode);
  const head = entries[entries.length - 1]!;
  const stats = aggregatePendingStats(entries);
  const open = expanded || reviewMode;

  return (
    <div className="vyotiq-stepfade-once group flex flex-col">
      <PendingFileRowShell
        expanded={open}
        showExpand={!reviewMode}
        {...(!reviewMode ? { onToggleExpand: () => setExpanded((v) => !v) } : {})}
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
            hoverGated={!reviewMode}
            alwaysVisible={reviewMode}
            showOpen
            compact
          />
        }
      />
      {open && (
        <div className={pendingPanelListClassName}>
          {entries.map((entry, index) => (
            <RowFrame key={entry.entryId} virtualise={virtualise}>
              <PendingChangeRow
                change={entry}
                nested
                index={index + 1}
                total={entries.length}
                alwaysExpanded={reviewMode}
                {...(diffMaxHeightClass ? { diffMaxHeightClass } : {})}
                {...(linePick ? { linePick } : {})}
              />
            </RowFrame>
          ))}
        </div>
      )}
    </div>
  );
}
