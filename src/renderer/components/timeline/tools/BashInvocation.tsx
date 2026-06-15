/**
 * Bespoke renderer for the `bash` tool. Terminal-style:
 *   - Summary line: `$ <command>` (truncated).
 *   - Expanded: command banner, stdout, stderr (if any), exit-code footer.
 *
 * Live FS-aware diff (Phase 2 streaming diffs):
 *   When the orchestrator's `bashWriteParser` detects a single-target
 *   write pattern (`cat > path << 'EOF' ... EOF`, `echo '...' > path`,
 *   `printf '...' > path`) the run-level `DiffStreamer` emits
 *   `diff-stream` events that the reducer attaches to the streaming
 *   call's `partialToolCallArgs` entry. We surface those hunks here
 *   under a `streaming write` pane so the user sees the in-flight
 *   diff against the on-disk file body BEFORE the tool actually
 *   runs — same UX rhythm as `EditInvocation`'s partial preview.
 *   When the call settles (`partial: false` AND `diffStream`
 *   absent), this pane disappears; the regular stdout/stderr/exit
 *   panes carry the authoritative result.
 */

import type { ToolCall, ToolResult } from '@shared/types/tool.js';
import { resolveShellToolTitle } from '@shared/shell/displayShell.js';
import { getHostPlatform } from '../../../lib/hostPlatform.js';
import type { DiffStreamSnapshot, LiveToolOutputSnapshot } from '../reducer/types.js';
import { InvocationShell } from './shared/InvocationShell.js';
import { DetailPane } from './shared/DetailPane.js';
import { CodeBlock } from './shared/CodeBlock.js';
import { DiffStreamPane } from './shared/DiffStreamPane.js';
import { toolErrorBody, toolErrorHint } from './shared/toolErrorDisplay.js';

interface BashInvocationProps {
  call?: ToolCall;
  result?: ToolResult;
  dense?: boolean;
  rowKey?: string;
  /**
   * True when the call was synthesised from streaming
   * `tool-call-args-delta` events. Forwarded by `ToolInvocation`
   * so the bash renderer can flip into the live-streaming variant
   * (`EditDiffView` `variant="partial"` with trailing cursor).
   */
  partial?: boolean;
  /**
   * FS-aware live diff snapshot for detected `bash`-write commands.
   * Optional — absent for compound / non-write bash invocations
   * (the streamer skips those by design).
   */
  diffStream?: DiffStreamSnapshot;
  /** Live stdout/stderr while the command is still running. */
  liveOutput?: LiveToolOutputSnapshot;
}

function formatLiveElapsed(startedAt: number): string {
  const s = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function BashInvocation({
  call,
  result,
  dense,
  rowKey,
  partial,
  diffStream,
  liveOutput
}: BashInvocationProps) {
  const data = result?.data?.tool === 'bash' ? result.data : null;
  const command =
    typeof call?.args?.['command'] === 'string'
      ? (call.args['command'] as string)
      : (data?.command ?? '');

  const shellTitle =
    data?.runtime === 'powershell' || data?.runtime === 'bash'
      ? data.runtime
      : resolveShellToolTitle(getHostPlatform());
  const summary = command ? `$ ${command}` : shellTitle;

  // Show the streaming diff while in flight against an on-disk file
  // body. Hidden once the call settles (the authoritative
  // stdout/stderr/exit panes below carry the post-execution truth).
  const showDiffStream =
    partial === true && diffStream !== undefined && diffStream.tool === 'bash';

  const showLiveOutput =
    !data &&
    liveOutput !== undefined &&
    (liveOutput.stdout.length > 0 || liveOutput.stderr.length > 0);

  const hasDetail = Boolean(
    command || data || (result && !result.ok) || showDiffStream || showLiveOutput
  );
  const errorHint = toolErrorHint(result);

  const detail = hasDetail ? (
    <>
      {command && (
        <DetailPane label="command">
          <CodeBlock body={command} />
        </DetailPane>
      )}
      {showDiffStream && diffStream && (
        <DiffStreamPane
          diffStream={diffStream}
          label={diffStream.settled ? 'live write' : 'streaming write'}
        />
      )}
      {showLiveOutput && liveOutput && (
        <>
          {liveOutput.stdout.length > 0 && (
            <DetailPane
              label={
                liveOutput.stdoutTruncated
                  ? `stdout (live · ${formatLiveElapsed(liveOutput.startedAt)}, truncated)`
                  : `stdout (live · ${formatLiveElapsed(liveOutput.startedAt)})`
              }
            >
              <CodeBlock body={liveOutput.stdout} />
            </DetailPane>
          )}
          {liveOutput.stderr.length > 0 && (
            <DetailPane
              label={
                liveOutput.stderrTruncated
                  ? `stderr (live · ${formatLiveElapsed(liveOutput.startedAt)}, truncated)`
                  : `stderr (live · ${formatLiveElapsed(liveOutput.startedAt)})`
              }
              tone="danger"
            >
              <CodeBlock body={liveOutput.stderr} tone="danger" />
            </DetailPane>
          )}
        </>
      )}
      {data && data.stdout.length > 0 && (
        <DetailPane label={data.stdoutTruncated ? 'stdout (truncated)' : 'stdout'}>
          <CodeBlock body={data.stdout} />
        </DetailPane>
      )}
      {data && data.stderr.length > 0 && (
        <DetailPane
          label={data.stderrTruncated ? 'stderr (truncated)' : 'stderr'}
          tone="danger"
        >
          <CodeBlock body={data.stderr} tone="danger" />
        </DetailPane>
      )}
      {data && (
        <div className="font-mono text-row text-text-muted">
          {data.timedOut
            ? 'exit: TIMEOUT'
            : data.signal
              ? `signal: ${data.signal}`
              : `exit: ${data.exitCode ?? '?'}`}
        </div>
      )}
      {!data && result && !result.ok && (
        <DetailPane label="error" tone="danger">
          <div className="font-mono text-row text-danger whitespace-pre-wrap">
            {toolErrorBody(result)}
          </div>
        </DetailPane>
      )}
    </>
  ) : undefined;

  // Live-stream auto-expand. Mirrors `EditInvocation`: open the row
  // automatically while a streaming write diff is in flight so the
  // user sees the hunks materialise without clicking. Surrenders
  // to manual override; collapses naturally once `showDiffStream`
  // flips false on settle.
  const liveAutoExpand = showDiffStream || showLiveOutput;

  return (
    <InvocationShell
      title={shellTitle}
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
