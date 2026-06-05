/**
 * Bespoke renderer for the `memory` tool. Shows action/scope/key in the
 * summary; expanded detail previews the markdown body.
 */

import type { ToolCall, ToolResult } from '@shared/types/tool.js';
import { InvocationShell } from './shared/InvocationShell.js';
import { DetailPane } from './shared/DetailPane.js';
import { CodeBlock } from './shared/CodeBlock.js';
import { toolErrorBody, toolErrorHint } from './shared/toolErrorDisplay.js';
import { useAppViewStore } from '../../../store/useAppViewStore.js';
import { timelineActionPillClassName } from '../shared/rowStyles.js';
import { cn } from '../../../lib/cn.js';

interface MemoryInvocationProps {
  call?: ToolCall;
  result?: ToolResult;
  dense?: boolean;
  rowKey?: string;
  partial?: boolean;
}

export function MemoryInvocation({ call, result, dense, rowKey, partial }: MemoryInvocationProps) {
  const openMemorySettings = useAppViewStore((s) => s.openSettings);
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

  const errorHint = toolErrorHint(result);

  let detail: React.ReactNode = undefined;
  if (data?.preview) {
    detail = (
      <DetailPane label={key ? `note: ${key}` : `scope: ${scope}`}>
        <CodeBlock body={data.preview} />
      </DetailPane>
    );
  } else if (result && !result.ok) {
    detail = (
      <DetailPane label="error" tone="danger">
        <div className="font-mono text-row text-danger whitespace-pre-wrap">
          {toolErrorBody(result)}
        </div>
      </DetailPane>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      <InvocationShell
        title="memory"
        summary={summary}
        mono
        ok={result ? result.ok : null}
        {...(errorHint ? { errorHint } : {})}
        {...(detail !== undefined ? { detail } : {})}
        {...(dense ? { dense } : {})}
        {...(rowKey ? { rowKey } : {})}
        call={call}
        result={result}
        partial={partial}
      />
      {result?.ok && (
        <button
          type="button"
          onClick={() => openMemorySettings('memory')}
          className={cn(timelineActionPillClassName, 'ml-5 text-meta')}
        >
          Open memory settings…
        </button>
      )}
    </div>
  );
}
