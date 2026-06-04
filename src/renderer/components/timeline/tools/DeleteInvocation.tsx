/**
 * Renderer for the `delete` tool.
 */

import type { ToolCall, ToolResult } from '@shared/types/tool.js';
import type { DiffStreamSnapshot } from '../reducer/types.js';
import { InvocationShell } from './shared/InvocationShell.js';
import { DetailPane } from './shared/DetailPane.js';
import { DiffStatsBadge } from './shared/DiffStatsBadge.js';
import { DiffStreamPane } from './shared/DiffStreamPane.js';
import { toolErrorBody, toolErrorHint } from './shared/toolErrorDisplay.js';
import { CodeBlock } from './shared/CodeBlock.js';

interface DeleteInvocationProps {
  call?: ToolCall;
  result?: ToolResult;
  dense?: boolean;
  rowKey?: string;
  partial?: boolean;
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

  const errorHint = toolErrorHint(result);
  const errorBody = toolErrorBody(result);

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
        <span className="text-text-faint">Snapshot saved · revert from timeline</span>
      </div>
    );
  } else if (showDiffStream && diffStream) {
    detail = (
      <DiffStreamPane
        diffStream={diffStream}
        label={diffStream.settled ? 'live removal' : 'streaming removal'}
      />
    );
  } else if (result && !result.ok) {
    detail = (
      <DetailPane label="error" tone="danger">
        <CodeBlock body={errorBody} tone="danger" />
      </DetailPane>
    );
  }

  const liveAutoExpand = showDiffStream;

  return (
    <InvocationShell
      title="delete"
      summary={summary}
      mono
      ok={result ? result.ok : null}
      {...(errorHint ? { errorHint } : {})}
      {...(detail !== undefined ? { detail } : {})}
      {...(dense ? { dense } : {})}
      {...(rowKey ? { rowKey } : {})}
      {...(liveAutoExpand ? { liveAutoExpand } : {})}
      call={call}
      result={result}
      partial={partial}
    />
  );
}
