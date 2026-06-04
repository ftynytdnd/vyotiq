/**
 * Shared chrome for a tool invocation row. Collapsed: flush Cascade-style
 * log line. Expanded: flat or nested detail via `DetailShell`.
 */

import { type MouseEvent, type ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import type { ToolCall, ToolResult } from '@shared/types/tool.js';
import { cn } from '../../../../lib/cn.js';
import { SHELL_ACTION_ICON_STROKE, SHELL_ROW_ICON_CLASS } from '../../../../lib/shellIcons.js';
import { DetailShell } from '../../shared/DetailShell.js';
import { TimelineRowHeader } from '../../shared/TimelineRowHeader.js';
import { useTimelineRowExpand } from '../../shared/useTimelineRowExpand.js';
import { timelineActionPillClassName, toolTitleClassName } from '../../shared/rowStyles.js';
import { canRerunToolCall, useToolRerun } from './useToolRerun.js';

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
  call?: ToolCall;
  result?: ToolResult;
  partial?: boolean;
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
  detailVariant,
  call,
  result,
  partial
}: InvocationShellProps) {
  const { rerun, busyCallId, canRerun } = useToolRerun();
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
  const settled = Boolean(result && partial !== true);
  const rerunnable = canRerun && settled && call && canRerunToolCall(call);
  const rerunBusy = Boolean(call && busyCallId === call.id);

  const onContextMenu = (e: MouseEvent<HTMLDivElement>) => {
    if (!rerunnable || !call) return;
    e.preventDefault();
    void rerun(call);
  };

  const rerunAction =
    rerunnable && call ? (
      <button
        type="button"
        disabled={rerunBusy}
        onClick={() => void rerun(call)}
        className={cn(timelineActionPillClassName, 'text-meta')}
        title="Re-run this tool"
      >
        <RotateCcw
          className={cn(SHELL_ROW_ICON_CLASS, rerunBusy && 'animate-spin')}
          strokeWidth={SHELL_ACTION_ICON_STROKE}
        />
        Re-run
      </button>
    ) : null;

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
    <div className="vyotiq-stepfade-once flex flex-col" onContextMenu={onContextMenu}>
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
        {rerunAction}
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
