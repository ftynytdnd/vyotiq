/**
 * Renderer for the `'unknown'` tool sentinel produced by the main-process
 * tool runner when an inbound tool name does not match any registered
 * tool. Surfaces the failure plainly instead of silently mislabeling the
 * row as a bash invocation. The user only sees this card when something
 * has actually gone wrong upstream (a stale model emitting a tool name we
 * removed, a corrupted persisted transcript, etc.).
 */

import { useMemo } from 'react';
import type { ToolCall, ToolResult } from '@shared/types/tool.js';
import { InvocationShell } from './shared/InvocationShell.js';
import { DetailPane } from './shared/DetailPane.js';
import { CodeBlock } from './shared/CodeBlock.js';

interface UnknownInvocationProps {
  call?: ToolCall;
  result?: ToolResult;
  dense?: boolean;
  rowKey?: string;
}

export function UnknownInvocation({ call, result, dense, rowKey }: UnknownInvocationProps) {
  const requestedName =
    typeof call?.name === 'string' && call.name !== 'unknown'
      ? call.name
      : typeof result?.name === 'string' && result.name !== 'unknown'
        ? result.name
        : '(unspecified)';
  const summary = `Unknown tool: ${requestedName}`;
  const errorHint = result?.error ?? 'unknown tool';
  const args = useMemo(
    () => (call?.args ? JSON.stringify(call.args, null, 2) : ''),
    [call?.args]
  );

  const detail = (
    <>
      {result?.output && (
        <DetailPane label="output" tone="danger">
          <CodeBlock body={result.output} tone="danger" />
        </DetailPane>
      )}
      {args && (
        <DetailPane label="requested arguments">
          <CodeBlock body={args} />
        </DetailPane>
      )}
    </>
  );

  return (
    <InvocationShell
      title="unknown"
      summary={summary}
      mono
      ok={result ? result.ok : false}
      errorHint={errorHint}
      detail={detail}
      {...(dense ? { dense } : {})}
      {...(rowKey ? { rowKey } : {})}
    />
  );
}
