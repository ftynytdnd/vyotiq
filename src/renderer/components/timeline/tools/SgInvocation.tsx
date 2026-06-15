/**
 * Bespoke renderer for the `sg` tool (ast-grep CLI run/scan/test).
 */

import type { ToolCall, ToolResult } from '@shared/types/tool.js';
import { InvocationShell } from './shared/InvocationShell.js';
import { DetailPane } from './shared/DetailPane.js';
import { chromeCodeSurfaceClassName } from '../../ui/SurfaceShell.js';
import { toolErrorBody, toolErrorHint } from './shared/toolErrorDisplay.js';

interface SgInvocationProps {
  call?: ToolCall;
  result?: ToolResult;
  dense?: boolean;
  rowKey?: string;
}

export function SgInvocation({ call, result, dense, rowKey }: SgInvocationProps) {
  const data = result?.data?.tool === 'sg' ? result.data : null;
  const action =
    typeof call?.args?.['action'] === 'string'
      ? (call.args['action'] as string)
      : (data?.action ?? 'run');

  const pattern =
    typeof call?.args?.['pattern'] === 'string' ? (call.args['pattern'] as string) : '';
  const rulePath =
    typeof call?.args?.['rulePath'] === 'string' ? (call.args['rulePath'] as string) : '';
  const configPath =
    typeof call?.args?.['configPath'] === 'string' ? (call.args['configPath'] as string) : '';

  const targetLabel =
    action === 'run'
      ? pattern
        ? `"${pattern}"`
        : ''
      : configPath || rulePath;

  const summary = `sg ${action}${targetLabel ? ` · ${targetLabel}` : ''}`;

  const errorHint = toolErrorHint(result);

  let detail: React.ReactNode = undefined;
  if (data) {
    detail = (
      <DetailPane label="output">
        <div className={chromeCodeSurfaceClassName('max-h-96 overflow-auto px-2 py-2')}>
          {data.stdout ? (
            <pre className="font-mono text-row text-text-secondary whitespace-pre-wrap break-all">
              {data.stdout}
            </pre>
          ) : null}
          {data.stderr ? (
            <pre className="mt-2 font-mono text-row text-danger whitespace-pre-wrap break-all">
              {data.stderr}
            </pre>
          ) : null}
          {!data.stdout && !data.stderr ? (
            <span className="font-mono text-row text-text-faint">No output.</span>
          ) : null}
        </div>
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
    <InvocationShell
      title="sg"
      summary={summary}
      mono
      ok={result ? result.ok : null}
      {...(errorHint ? { errorHint } : {})}
      {...(detail !== undefined ? { detail } : {})}
      {...(dense ? { dense } : {})}
      {...(rowKey ? { rowKey } : {})}
    />
  );
}
