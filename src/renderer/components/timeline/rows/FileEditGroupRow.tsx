/**
 * FileEditGroupRow — rolled-up line for consecutive file-edit events.
 */

import { useMemo } from 'react';
import type { FileEditGroupChild } from '../reducer/deriveRows.js';
import { FileEditRow } from './FileEditRow.js';
import { FileEditDiffPanel } from './FileEditDiffPanel.js';
import { DiffStatsBadge } from '../tools/shared/DiffStatsBadge.js';
import { DetailShell } from '../shared/DetailShell.js';
import { TimelineRowHeader } from '../shared/TimelineRowHeader.js';
import { useTimelineRowExpand } from '../shared/useTimelineRowExpand.js';

interface FileEditGroupRowProps {
  rowKey: string;
  items: FileEditGroupChild[];
  subagentId?: string;
  runId?: string;
}

export function FileEditGroupRow({ rowKey, items, subagentId, runId }: FileEditGroupRowProps) {
  const { expanded, onToggle } = useTimelineRowExpand({ rowKey });

  const { primary, rest, additions, deletions } = useMemo(() => {
    let a = 0;
    let d = 0;
    for (const c of items) {
      a += c.additions;
      d += c.deletions;
    }
    return {
      primary: items[0]?.filePath ?? '',
      rest: Math.max(0, items.length - 1),
      additions: a,
      deletions: d
    };
  }, [items]);

  const suffix = rest > 0 ? ` and ${rest} other file${rest === 1 ? '' : 's'}` : '';

  const label = (
    <span className="inline-flex min-w-0 max-w-full items-baseline gap-1 truncate text-row">
      <span className="vx-row-label">Edited</span>{' '}
      <span className="vx-provider-meta text-text-secondary">{primary}</span>
      {suffix && <span className="vx-caption">{suffix}</span>}
    </span>
  );

  return (
    <div className="vyotiq-stepfade-once flex flex-col" data-row-kind="file-edit-group">
      <TimelineRowHeader
        expanded={expanded}
        onToggle={onToggle}
        expandable
        expandAriaLabel={expanded ? 'Collapse file edits' : 'Expand file edits'}
        rowAnchorKey={rowKey}
        trailing={
          <DiffStatsBadge additions={additions} deletions={deletions} className="shrink-0" />
        }
      >
        {label}
      </TimelineRowHeader>

      {expanded && (
        <DetailShell variant="flat" gap="gap-2">
          {items.length === 1 && (
            <FileEditDiffPanel
              {...(items[0]!.entryId ? { entryId: items[0]!.entryId } : {})}
              filePath={items[0]!.filePath}
              {...(runId ? { runId } : {})}
              {...(subagentId ? { subagentId } : {})}
            />
          )}
          {items.map((c) => (
            <FileEditRow
              key={c.key}
              filePath={c.filePath}
              additions={c.additions}
              deletions={c.deletions}
              {...(c.entryId ? { entryId: c.entryId } : {})}
              {...(subagentId ? { subagentId } : {})}
              {...(runId ? { runId } : {})}
            />
          ))}
        </DetailShell>
      )}
    </div>
  );
}
