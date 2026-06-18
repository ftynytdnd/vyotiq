/**
 * Bespoke renderer for the `capture` tool — shows target and saved path.
 */

import type { ToolCall, ToolResult } from '@shared/types/tool.js';
import { InvocationShell } from './shared/InvocationShell.js';
import { DetailPane } from './shared/DetailPane.js';
import { toolErrorHint } from './shared/toolErrorDisplay.js';

interface CaptureInvocationProps {
  call?: ToolCall;
  result?: ToolResult;
  dense?: boolean;
  rowKey?: string;
}

export function CaptureInvocation({ call, result, dense, rowKey }: CaptureInvocationProps) {
  const target =
    typeof call?.args?.['target'] === 'string' ? (call.args['target'] as string) : 'capture';
  const summary = result?.ok
    ? `Captured ${target}`
    : result && !result.ok
      ? (result.error ?? 'capture failed')
      : `capture ${target}`;

  const errorHint = toolErrorHint(result);
  const detail =
    result?.output && result.output.length > 0 ? (
      <DetailPane label="capture result">
        <pre className="whitespace-pre-wrap font-mono text-row text-text-secondary">{result.output}</pre>
      </DetailPane>
    ) : undefined;

  return (
    <InvocationShell
      title="capture"
      summary={summary}
      detail={detail}
      errorHint={errorHint}
      dense={dense}
      rowKey={rowKey}
      ok={result ? result.ok : null}
    />
  );
}
