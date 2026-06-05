/**
 * Terminal `finish` tool — the model's explicit end-of-run signal.
 * Orchestrator intercept handles execution; this card only surfaces
 * the delivered summary without mislabeling the row as an error.
 */

import type { ToolCall, ToolResult } from '@shared/types/tool.js';
import { InvocationShell } from './shared/InvocationShell.js';

interface FinishInvocationProps {
  call?: ToolCall;
  result?: ToolResult;
  dense?: boolean;
  rowKey?: string;
  partial?: boolean;
}

function readSummary(call?: ToolCall, result?: ToolResult): string {
  const fromArgs = call?.args?.['summary'];
  if (typeof fromArgs === 'string' && fromArgs.trim().length > 0) {
    return fromArgs.trim();
  }
  if (result?.ok && typeof result.output === 'string' && result.output.trim().length > 0) {
    return result.output.trim();
  }
  return 'Done.';
}

export function FinishInvocation({ call, result, dense, rowKey, partial }: FinishInvocationProps) {
  const summary = readSummary(call, result);
  const compact =
    summary.length > 96 ? `${summary.slice(0, 93).trimEnd()}…` : summary;

  return (
    <InvocationShell
      title="finish"
      summary={compact}
      ok={result === undefined ? (partial ? null : true) : result.ok}
      {...(dense ? { dense } : {})}
      {...(rowKey ? { rowKey } : {})}
      {...(partial ? { partial } : {})}
      call={call}
      result={result}
    />
  );
}
