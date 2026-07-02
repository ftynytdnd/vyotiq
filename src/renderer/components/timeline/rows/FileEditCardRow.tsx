/**
 * Root-level file edit card — streaming, settling, or settled.
 */

import { memo, useMemo } from 'react';
import type { DiffHunk } from '@shared/types/tool.js';
import type { FileEditCardRevision } from '../reducer/deriveRows.js';
import { cn } from '../../../lib/cn.js';
import { FileChangeCard } from '../../diff/FileChangeCard.js';
import { EditDiffView } from '../tools/edit/EditDiffView.js';
import { DiffStatsBadge } from '../tools/shared/DiffStatsBadge.js';
import { DetailShell } from '../shared/DetailShell.js';
import { TimelineRowHeader } from '../shared/TimelineRowHeader.js';
import { useTimelineRowExpand } from '../shared/useTimelineRowExpand.js';

interface FileEditCardRowProps {
  rowKey: string;
  filePath: string;
  additions: number;
  deletions: number;
  hunks?: DiffHunk[];
  phase: 'pending' | 'streaming' | 'settling' | 'settled';
  revisions?: FileEditCardRevision[];
}

export const FileEditCardRow = memo(function FileEditCardRow({
  rowKey,
  filePath,
  additions,
  deletions,
  hunks,
  phase,
  revisions
}: FileEditCardRowProps) {
  const live = phase === 'streaming';
  const settling = phase === 'settling';
  const settled = phase === 'settled';
  const hasHunks = Boolean(hunks && hunks.length > 0);
  const maxHeightClass = live || settling ? 'max-h-52' : 'max-h-24';
  const editCount = 1 + (revisions?.length ?? 0);
  const hasRevisions = editCount > 1;
  const { expanded, onToggle } = useTimelineRowExpand({
    rowKey: `${rowKey}:revisions`,
    defaultExpanded: false
  });
  const panelId = `file-edit-revisions-${rowKey}`;

  const statusLabel = useMemo(() => {
    if (!hasRevisions || !settled) return undefined;
    return `${editCount} edits`;
  }, [editCount, hasRevisions, settled]);

  const mainCard = hasHunks ? (
    <EditDiffView
      hunks={hunks!}
      variant={live || settling ? 'partial' : 'authoritative'}
      filePath={filePath}
      additions={additions}
      deletions={deletions}
      pending={live}
      hideStreamCursor={live || settling}
      handoff={settling}
      maxHeightClass={maxHeightClass}
      statusLabel={statusLabel}
    />
  ) : (
    <FileChangeCard
      filePath={filePath}
      additions={additions}
      deletions={deletions}
      variant={live || settling ? 'partial' : 'authoritative'}
      pending={live}
      statusLabel={statusLabel}
    />
  );

  return (
    <div
      className={cn(
        'vx-file-edit-card vyotiq-stepfade-once',
        live && 'vx-file-edit-card--live',
        settling && 'vx-file-edit-card--settling',
        settled && 'vx-file-edit-card--settled',
        hasRevisions && settled && 'vx-file-edit-card--consolidated'
      )}
      data-row-kind="file-edit-card"
      data-phase={phase}
      data-row-key={rowKey}
      data-edit-count={hasRevisions ? editCount : undefined}
    >
      {mainCard}
      {hasRevisions && settled ? (
        <div className="vx-file-edit-revisions">
          <TimelineRowHeader
            expanded={expanded}
            onToggle={onToggle}
            panelId={panelId}
            className="vx-timeline-activity-row px-1"
          >
            <span className="font-mono text-meta text-text-faint">
              {expanded
                ? 'Hide earlier edits'
                : `Show ${editCount - 1} earlier edit${editCount - 1 === 1 ? '' : 's'}`}
            </span>
          </TimelineRowHeader>
          <DetailShell id={panelId} expanded={expanded}>
            <ul className="flex flex-col gap-1 px-1 pb-1">
              {revisions!.map((rev) => (
                <li
                  key={rev.callId}
                  className="flex min-w-0 items-center gap-2 rounded-inner bg-surface-raised/30 px-2 py-1"
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-meta text-text-faint">
                    revision
                  </span>
                  <DiffStatsBadge
                    additions={rev.additions}
                    deletions={rev.deletions}
                    className="shrink-0"
                  />
                </li>
              ))}
            </ul>
          </DetailShell>
        </div>
      ) : null}
    </div>
  );
});
