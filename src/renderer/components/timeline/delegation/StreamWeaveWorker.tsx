/**
 * One worker section with inline tag, prose, tool footnotes, and optional lab expand.
 */

import type { ReactNode } from 'react';
import { useChatStore } from '../../../store/useChatStore.js';
import { cn } from '../../../lib/cn.js';
import { useTimelineRowExpand } from '../shared/useTimelineRowExpand.js';
import { DelegationBriefingChips } from './DelegationBriefingChips.js';
import { DelegationInlineProse } from './DelegationInlineProse.js';
import { DelegationLabPanel } from './DelegationLabPanel.js';
import { DelegationToolFootnote } from './DelegationToolFootnote.js';
import { footnoteMarker, workerHasInlineOutput } from './delegationHelpers.js';
import type { DisplayRow } from '../shared/projectSubagentRows.js';

interface StreamWeaveWorkerProps {
  subagentId: string;
  tag: string;
  rows: DisplayRow[];
  renderRow: (row: DisplayRow) => ReactNode;
  live?: boolean;
}

export function StreamWeaveWorker({
  subagentId,
  tag,
  rows,
  renderRow,
  live = false
}: StreamWeaveWorkerProps) {
  const snap = useChatStore((s) => s.subagents[subagentId]);
  const rowKey = `delegation:${subagentId}`;
  const { expanded, onToggle } = useTimelineRowExpand({
    rowKey,
    defaultExpanded: false,
    liveAutoExpand: false
  });

  if (!snap) return null;

  const running = snap.status === 'pending' || snap.status === 'running';
  const failed =
    snap.status === 'failed' ||
    snap.status === 'malformed' ||
    snap.status === 'aborted';

  const inlineRows = rows.filter((r) => r.kind !== 'subagent-line');
  const hasBriefing =
    (snap.files?.length ?? 0) > 0 ||
    (snap.tools?.length ?? 0) > 0 ||
    (snap.unknownTools?.length ?? 0) > 0;
  const hasLabDetail =
    snap.steps.length > 0 ||
    snap.iterationOrder.length > 0 ||
    (typeof snap.output === 'string' && snap.output.trim().length > 0);

  if (
    !workerHasInlineOutput(inlineRows) &&
    !running &&
    !hasBriefing &&
    !hasLabDetail
  ) {
    return null;
  }

  const proseRows = inlineRows.filter((r) => r.kind === 'assistant-text');
  const reasoningRows = inlineRows.filter((r) => r.kind === 'reasoning-line');
  const toolRows = inlineRows.filter(
    (r) => r.kind === 'tool-group' || r.kind === 'file-edit-group'
  );

  const workerLive = live && running;
  const showLabToggle = !live && !running;

  return (
    <section
      className="vx-timeline-deleg-weave-worker"
      data-row-kind="delegation-worker"
      data-subagent-id={subagentId}
    >
      <p className="vx-timeline-deleg-weave-line m-0 text-chat-body text-text-primary">
        <span
          className={cn(
            'vx-timeline-deleg-weave-tag',
            failed && 'vx-timeline-deleg-tag-failed',
            workerLive && 'vx-timeline-deleg-tag-live'
          )}
        >
          {tag}
        </span>{' '}
        {proseRows.map((row) =>
          row.kind === 'assistant-text' ? (
            <DelegationInlineProse
              key={row.key}
              id={row.id}
              subagentId={subagentId}
              live={workerLive}
            />
          ) : null
        )}
        {proseRows.length === 0 && running ? (
          <span className="text-text-faint">…</span>
        ) : null}
        {toolRows.map((row, i) => (
          <sup key={row.key} className="vx-timeline-deleg-weave-fn" aria-hidden>
            {footnoteMarker(i + 1)}
          </sup>
        ))}
      </p>

      {reasoningRows.length > 0 ? (
        <div className="vx-timeline-deleg-weave-reasoning flex flex-col gap-0.5 pl-5">
          {reasoningRows.map((row) => (
            <div key={row.key}>{renderRow(row)}</div>
          ))}
        </div>
      ) : null}

      {toolRows.length > 0 ? (
        <div
          className="vx-timeline-deleg-weave-footnotes"
          aria-label={`Tools for worker ${tag}`}
        >
          {toolRows.map((row, i) => (
            <DelegationToolFootnote key={row.key} row={row} index={i + 1} live={workerLive} />
          ))}
        </div>
      ) : null}

      <DelegationBriefingChips snap={snap} />

      {showLabToggle ? (
        <>
          <button
            type="button"
            onClick={onToggle}
            className="vx-btn vx-btn-quiet vx-timeline-deleg-lab-open px-0 py-0 text-meta text-text-faint"
            aria-expanded={expanded}
          >
            {expanded ? 'Hide trace' : 'Show trace'}
          </button>
          {expanded ? <DelegationLabPanel snap={snap} /> : null}
        </>
      ) : null}
    </section>
  );
}
