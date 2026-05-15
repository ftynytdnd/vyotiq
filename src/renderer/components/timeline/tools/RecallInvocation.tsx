/**
 * Bespoke renderer for the `recall` tool. Surfaces the action and (for
 * `read`) the recalled conversation id; the expanded detail previews
 * the rendered transcript / list.
 */

import { History } from 'lucide-react';
import type { ToolCall, ToolResult } from '@shared/types/tool.js';
import { InvocationShell } from './shared/InvocationShell.js';
import { DetailPane } from './shared/DetailPane.js';
import { CodeBlock } from './shared/CodeBlock.js';

interface RecallInvocationProps {
  call?: ToolCall;
  result?: ToolResult;
  dense?: boolean;
  rowKey?: string;
}

export function RecallInvocation({ call, result, dense, rowKey }: RecallInvocationProps) {
  const data = result?.data?.tool === 'recall' ? result.data : null;
  const action =
    (typeof call?.args?.['action'] === 'string'
      ? (call.args['action'] as string)
      : data?.action) ?? '?';
  const targetId =
    (typeof call?.args?.['conversationId'] === 'string'
      ? (call.args['conversationId'] as string)
      : data?.conversationId) ?? '';

  // Compact, single-line summary. For `list` the count is the most
  // useful breadcrumb; for `read` the truncated id anchors the row to
  // a specific conversation without printing the full UUID.
  const summary =
    action === 'list'
      ? `list (${data?.count ?? 0})`
      : targetId
        ? `read ${targetId.slice(0, 8)}…`
        : 'read';

  const errorHint = result && !result.ok ? result.error : undefined;

  let detail: React.ReactNode = undefined;
  if (data?.preview) {
    detail = (
      <DetailPane label={action === 'list' ? 'conversations' : 'transcript'}>
        <CodeBlock body={data.preview} />
      </DetailPane>
    );
  } else if (result?.error) {
    detail = (
      <DetailPane label="error" tone="danger">
        <CodeBlock body={result.error} tone="danger" />
      </DetailPane>
    );
  }

  return (
    <InvocationShell
      Icon={History}
      title="recall"
      summary={summary}
      ok={result ? result.ok : null}
      {...(errorHint ? { errorHint } : {})}
      {...(detail !== undefined ? { detail } : {})}
      {...(dense ? { dense } : {})}
      {...(rowKey ? { rowKey } : {})}
    />
  );
}
