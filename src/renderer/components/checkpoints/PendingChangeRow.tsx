/**
 * One pending change — expandable diff row inside the pending panel.
 */

import { useState } from 'react';
import type { PendingChange } from '@shared/types/checkpoint.js';
import { DiffStatsBadge } from '../timeline/tools/shared/DiffStatsBadge.js';
import { PendingChangeDiff } from './PendingChangeDiff.js';
import { InlinePendingActions } from './shared/InlinePendingActions.js';
import {
  PendingChangeAttribution,
  PendingChangePathLabel
} from './shared/PendingChangeAttribution.js';
import { PendingFileRowShell } from './pending/PendingFileRowShell.js';
import { cn } from '../../lib/cn.js';
import { pendingDiffInsetClassName } from './pending/pendingPanelStyles.js';
import type { ReviewLinePickProps } from '../timeline/tools/edit/diff/diffLinePick.js';

interface PendingChangeRowProps {
  change: PendingChange;
  alwaysExpanded?: boolean;
  nested?: boolean;
  index?: number;
  total?: number;
  diffMaxHeightClass?: string;
  linePick?: ReviewLinePickProps;
}

export function PendingChangeRow({
  change,
  alwaysExpanded = false,
  nested = false,
  index,
  total,
  diffMaxHeightClass,
  linePick
}: PendingChangeRowProps) {
  const [expanded, setExpanded] = useState(true);
  const open = alwaysExpanded || expanded;

  return (
    <div className={cn('vyotiq-stepfade-once group flex flex-col', nested && 'bg-surface-overlay/[0.07]')}>
      <PendingFileRowShell
        nested={nested}
        expanded={open}
        showExpand={!alwaysExpanded}
        {...(!alwaysExpanded ? { onToggleExpand: () => setExpanded((v) => !v) } : {})}
        path={
          nested ? (
            <>
              <div
                className="min-w-0 truncate font-mono text-meta text-text-muted"
                title={change.filePath}
              >
                edit {index ?? 1}
                {total && total > 1 ? ` / ${total}` : ''}
              </div>
              <PendingChangeAttribution change={change} />
            </>
          ) : (
            <>
              <PendingChangePathLabel change={change} />
              <PendingChangeAttribution change={change} />
            </>
          )
        }
        stats={
          <DiffStatsBadge
            additions={change.additions}
            deletions={change.deletions}
            minWidth="badge"
          />
        }
        actions={
          <InlinePendingActions
            change={change}
            hoverGated={!alwaysExpanded}
            alwaysVisible={alwaysExpanded}
            showOpen={!nested}
            compact
          />
        }
      />
      {open && (
        <div className={pendingDiffInsetClassName}>
          <div className="px-2 py-1.5">
            <PendingChangeDiff
              workspaceId={change.workspaceId}
              kind={change.kind}
              {...(change.preHash ? { preHash: change.preHash } : {})}
              {...(change.postHash ? { postHash: change.postHash } : {})}
              {...(diffMaxHeightClass ? { maxHeightClass: diffMaxHeightClass } : {})}
              {...(linePick ? { linePick } : {})}
            />
          </div>
        </div>
      )}
    </div>
  );
}
