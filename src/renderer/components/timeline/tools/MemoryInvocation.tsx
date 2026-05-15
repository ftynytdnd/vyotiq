/**
 * Bespoke renderer for the `memory` tool. Shows action/scope/key in the
 * summary; expanded detail previews the markdown body.
 */

import { Brain } from 'lucide-react';
import type { ToolCall, ToolResult } from '@shared/types/tool.js';
import { InvocationShell } from './shared/InvocationShell.js';
import { DetailPane } from './shared/DetailPane.js';
import { CodeBlock } from './shared/CodeBlock.js';

interface MemoryInvocationProps {
  call?: ToolCall;
  result?: ToolResult;
  dense?: boolean;
  rowKey?: string;
}

export function MemoryInvocation({ call, result, dense, rowKey }: MemoryInvocationProps) {
  const data = result?.data?.tool === 'memory' ? result.data : null;
  const action =
    (typeof call?.args?.['action'] === 'string'
      ? (call.args['action'] as string)
      : data?.action) ?? '?';
  const scope =
    (typeof call?.args?.['scope'] === 'string'
      ? (call.args['scope'] as string)
      : data?.scope) ?? '?';
  const key =
    (typeof call?.args?.['key'] === 'string'
      ? (call.args['key'] as string)
      : data?.key) ?? '';

  const summary = key
    ? `${action} ${scope}/${key}`
    : `${action} ${scope}`;

  const errorHint = result && !result.ok ? result.error : undefined;

  let detail: React.ReactNode = undefined;
  if (data?.preview) {
    detail = (
      <DetailPane label={key ? `note: ${key}` : `scope: ${scope}`}>
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
      Icon={Brain}
      title="memory"
      summary={summary}
      ok={result ? result.ok : null}
      {...(errorHint ? { errorHint } : {})}
      {...(detail !== undefined ? { detail } : {})}
      {...(dense ? { dense } : {})}
      {...(rowKey ? { rowKey } : {})}
    />
  );
}
