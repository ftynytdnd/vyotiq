/**
 * Renderer for the `delete` tool. Mirrors `EditInvocation`'s shell
 * rhythm — `InvocationShell` carries the verb badge and the row reads
 * as a sibling of edits in the timeline.
 *
 * The body intentionally does NOT show the deleted file's contents on
 * the SETTLED path:
 *   - The full snapshot is available through Checkpoints → File
 *     history (Restore pre).
 *   - Inlining a potentially large file body in every timeline row
 *     would bloat the transcript without adding actionable
 *     information; the diff stat (`-N`) is the at-a-glance signal.
 *
 * Live FS-aware diff (Phase 2 streaming diffs):
 *   While the call is in flight, the run-level `DiffStreamer` emits
 *   `diff-stream` events for `delete` calls computed against the
 *   on-disk body (post-state is empty, so every line shows up as a
 *   `-` line in the synthesised diff). We surface that under a
 *   `streaming removal` pane so the user sees exactly what the agent
 *   is about to delete BEFORE the tool runs. The pane disappears the
 *   moment the call settles — the authoritative `data.deletedLines`
 *   row above is enough at that point, and re-painting the body
 *   would just bloat the row.
 */

import { Trash2 } from 'lucide-react';
import type { ToolCall, ToolResult } from '@shared/types/tool.js';
import type { DiffStreamSnapshot } from '../reducer/types.js';
import { InvocationShell } from './shared/InvocationShell.js';
import { DetailPane } from './shared/DetailPane.js';
import { DiffStatsBadge } from './shared/DiffStatsBadge.js';
import { EditDiffView } from './edit/EditDiffView.js';

interface DeleteInvocationProps {
  call?: ToolCall;
  result?: ToolResult;
  dense?: boolean;
  rowKey?: string;
  /**
   * True when the call was synthesised from streaming
   * `tool-call-args-delta` events. Forwarded by `ToolInvocation`
   * so the delete renderer can flip into the live-streaming variant.
   */
  partial?: boolean;
  /**
   * FS-aware live diff snapshot for in-flight delete calls.
   * Computed against the on-disk body with an empty after-state, so
   * every line shows up as a `-` line. Absent for delete calls
   * whose target is outside the workspace, oversized, or otherwise
   * unreadable (the synthesised renderer-side preview is the
   * fallback in those cases).
   */
  diffStream?: DiffStreamSnapshot;
}

export function DeleteInvocation({
  call,
  result,
  dense,
  rowKey,
  partial,
  diffStream
}: DeleteInvocationProps) {
  const data = result?.data?.tool === 'delete' ? result.data : null;
  const argPath =
    typeof call?.args?.['path'] === 'string' ? (call.args['path'] as string) : '';
  const path = data?.filePath ?? argPath;
  const summary = path || 'delete';

  const errorHint = result && !result.ok ? result.error : undefined;
  const errorBody =
    result && !result.ok
      ? result.output && result.output.length > 0
        ? result.output
        : (result.error ?? '')
      : '';

  // Show the streaming removal preview only while the call is in
  // flight AND the streamer has produced a snapshot. Hidden the
  // moment the call settles — `data.deletedLines` carries the
  // authoritative count from there.
  const showDiffStream =
    partial === true &&
    diffStream !== undefined &&
    diffStream.tool === 'delete' &&
    !data;

  let detail: React.ReactNode = undefined;
  if (data) {
    detail = (
      <div className="flex items-center gap-2 text-row text-text-muted">
        <span className="font-mono truncate" title={data.filePath}>
          {data.filePath}
        </span>
        <DiffStatsBadge additions={0} deletions={data.deletedLines} />
        <span className="text-text-faint">Snapshot saved · revert in Checkpoints</span>
      </div>
    );
  } else if (showDiffStream) {
    detail = (
      <>
        <div className="flex items-center gap-2 text-row text-text-muted">
          <span className="font-mono truncate" title={diffStream.filePath}>
            {diffStream.filePath}
          </span>
          <DiffStatsBadge
            additions={diffStream.additions}
            deletions={diffStream.deletions}
            pending={!diffStream.settled}
          />
        </div>
        <DetailPane label={diffStream.settled ? 'live removal' : 'streaming removal'}>
          <EditDiffView
            key={diffStream.settled ? 'delete-stream-settled' : 'delete-stream-live'}
            hunks={diffStream.hunks}
            variant={diffStream.settled ? 'authoritative' : 'partial'}
          />
        </DetailPane>
      </>
    );
  } else if (result && !result.ok) {
    detail = (
      <div className="rounded-inner bg-danger/5 px-2 py-1 font-mono text-row text-danger">
        {errorBody}
      </div>
    );
  }

  // Live-stream auto-expand. Mirrors `EditInvocation`/`BashInvocation`:
  // open the row automatically while the streaming removal preview
  // is in flight; surrender to manual override; collapse naturally
  // on settle when `showDiffStream` flips false.
  const liveAutoExpand = showDiffStream;

  return (
    <InvocationShell
      Icon={Trash2}
      title="delete"
      summary={summary}
      mono
      ok={result ? result.ok : null}
      {...(errorHint ? { errorHint } : {})}
      {...(detail !== undefined ? { detail } : {})}
      {...(dense ? { dense } : {})}
      {...(rowKey ? { rowKey } : {})}
      {...(liveAutoExpand ? { liveAutoExpand } : {})}
    />
  );
}
