/**
 * FileEditGroupRow — rolled-up line for consecutive file-edit events.
 */

import { useMemo } from 'react';
import type { FileEditGroupChild } from '../reducer/deriveRows.js';
import { FileEditRow } from './FileEditRow.js';
import { DiffStatsBadge } from '../tools/shared/DiffStatsBadge.js';
import { DetailShell } from '../shared/DetailShell.js';
import { TimelineRowHeader } from '../shared/TimelineRowHeader.js';
import { useTimelineRowExpand } from '../shared/useTimelineRowExpand.js';
import { formatToolGroupDisplayPrimary } from '../shared/formatToolGroupDisplayPrimary.js';

interface FileEditGroupRowProps {
  rowKey: string;
  items: FileEditGroupChild[];
}

export function FileEditGroupRow({ rowKey, items }: FileEditGroupRowProps) {
  const { expanded, onToggle } = useTimelineRowExpand({ rowKey });
  const panelId = `file-edit-panel-${rowKey}`;

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

  const { display: primaryDisplay, title: primaryTitle } = useMemo(
    () => formatToolGroupDisplayPrimary('edit', primary),
    [primary]
  );

  const suffix = rest > 0 ? ` and ${rest} other file${rest === 1 ? '' : 's'}` : '';

  const label = (
    <span className="inline-flex min-w-0 max-w-full items-baseline gap-1 truncate text-row">
      <span className="vx-row-label">Edited</span>{' '}
      <span
        className="vx-provider-meta text-text-secondary"
        {...(primaryTitle ? { title: primaryTitle } : {})}
      >
        {primaryDisplay}
      </span>
      {suffix && <span className="vx-caption">{suffix}</span>}
    </span>
  );

  return (
    <div className="vx-timeline-activity-row vyotiq-stepfade-once flex flex-col" data-row-kind="file-edit-group">
      <TimelineRowHeader
        expanded={expanded}
        onToggle={onToggle}
        expandable
        chevronOnRight
        expandAriaLabel={expanded ? 'Collapse file edits' : 'Expand file edits'}
        rowAnchorKey={rowKey}
        panelId={panelId}
        trailing={
          <>
            {items.length > 1 ? (
              <span
                className="vx-tool-group-count shrink-0 font-mono tabular-nums"
                aria-label={`${items.length} file edits`}
              >
                ×{items.length}
              </span>
            ) : null}
            <DiffStatsBadge additions={additions} deletions={deletions} className="shrink-0" />
          </>
        }
      >
        {label}
      </TimelineRowHeader>

      {expanded && (
        <DetailShell variant="flat" gap="gap-2">
          <div id={panelId} className="contents">
            {items.map((c) => (
              <FileEditRow
                key={c.key}
                filePath={c.filePath}
                additions={c.additions}
                deletions={c.deletions}
              />
            ))}
          </div>
        </DetailShell>
      )}
    </div>
  );
}
