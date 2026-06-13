/**
 * Shared chrome for a tool invocation row. Collapsed: flush Cascade-style
 * log line. Expanded: flat or nested detail via `DetailShell`.
 */

import type { ReactNode } from 'react';
import { cn } from '../../../../lib/cn.js';
import { DetailShell } from '../../shared/DetailShell.js';
import { TimelineRowHeader } from '../../shared/TimelineRowHeader.js';
import { useTimelineRowExpand } from '../../shared/useTimelineRowExpand.js';
import { toolTitleClassName } from '../../shared/rowStyles.js';

interface InvocationShellProps {
  /** Leftmost label, e.g. "bash", "read", "edit". */
  title: string;
  /** One-line summary shown next to the title. Monospace when `mono` is true. */
  summary: string;
  mono?: boolean;
  /** null = pending, true = ok, false = fail. */
  ok: boolean | null;
  errorHint?: string;
  /** Expanded-detail body. Absent → row cannot expand. */
  detail?: ReactNode;
  /** Compact variant used when nested inside a tool group. */
  dense?: boolean;
  rowKey?: string;
  liveAutoExpand?: boolean;
  /** Parent tool-group row is expanded — show detail without a second click. */
  groupExpanded?: boolean;
  actions?: ReactNode;
  /** Detail shell variant when expanded. Defaults to `flat` in dense mode. */
  detailVariant?: 'nested' | 'flat';
}

export function InvocationShell({
  title,
  summary,
  mono = false,
  ok,
  errorHint,
  detail,
  dense = false,
  rowKey,
  liveAutoExpand = false,
  groupExpanded = false,
  actions,
  detailVariant
}: InvocationShellProps) {
  const canExpand = detail !== undefined && detail !== null;

  const failed = ok === false;
  const { expanded: open, onToggle } = useTimelineRowExpand({
    ...(rowKey ? { rowKey } : {}),
    defaultExpanded: failed ? false : undefined,
    liveAutoExpand: canExpand && !failed ? liveAutoExpand || groupExpanded : false
  });

  const onHeaderToggle = () => {
    if (!canExpand) return;
    onToggle();
  };

  const summaryText = 'text-row';
  const running = ok === null;
  const showDetailsToggle = failed && canExpand;

  const label = (
    <span
      className={cn('inline-flex min-w-0 max-w-full items-center gap-1.5', summaryText)}
      title={failed && errorHint ? errorHint : summary}
    >
      <span className={cn(toolTitleClassName(running), 'shrink-0')}>{title}</span>
      <span
        className={cn(
          'min-w-0 flex-1 truncate',
          mono && 'font-mono',
          running ? 'text-text-secondary' : ok === false ? 'text-danger' : 'text-text-muted'
        )}
      >
        {summary}
      </span>
    </span>
  );

  const shellVariant = detailVariant ?? (dense ? 'flat' : 'flat');

  return (
    <div className="vyotiq-stepfade-once flex flex-col">
      <div
        className={cn(
          'flex w-full items-center gap-1',
          dense ? 'py-0.5' : 'py-0'
        )}
      >
        <TimelineRowHeader
          expanded={open}
          onToggle={onHeaderToggle}
          expandable={canExpand}
          expandAriaLabel={
            canExpand
              ? `${open ? 'Collapse' : 'Expand'} ${title} tool details`
              : undefined
          }
          chevronSpacer={!canExpand}
          className="min-w-0 flex-1"
          {...(rowKey ? { rowAnchorKey: rowKey } : {})}
          trailing={undefined}
        >
          {label}
        </TimelineRowHeader>
        {showDetailsToggle ? (
          <button
            type="button"
            onClick={onToggle}
            className="shrink-0 text-meta text-text-faint underline-offset-2 hover:text-text-secondary hover:underline"
          >
            {open ? 'Hide details' : 'Show details'}
          </button>
        ) : null}
        {actions}
      </div>

      {open && canExpand && (
        <DetailShell variant={shellVariant} {...(dense ? { gap: 'gap-1' } : {})}>
          {detail}
        </DetailShell>
      )}
    </div>
  );
}
