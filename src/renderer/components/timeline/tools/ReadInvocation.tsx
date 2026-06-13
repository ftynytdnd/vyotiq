/**
 * Bespoke renderer for the `read` tool. Shows the file path + range in the
 * summary; expanded detail renders the file content with line numbers in
 * the gutter.
 */

import type { ToolCall, ToolResult } from '@shared/types/tool.js';
import { InvocationShell } from './shared/InvocationShell.js';
import { chromeCodeGutterClassName, chromeCodePanelClassName } from '../../ui/SurfaceShell.js';
import { cn } from '../../../lib/cn.js';
import { splitLinesUpTo, countLines } from '../../../lib/strings.js';
import { DetailPane } from './shared/DetailPane.js';
import { toolErrorBody, toolErrorHint } from './shared/toolErrorDisplay.js';

interface ReadInvocationProps {
  call?: ToolCall;
  result?: ToolResult;
  dense?: boolean;
  rowKey?: string;
}

const MAX_LINES_VISIBLE = 400;

export function ReadInvocation({ call, result, dense, rowKey }: ReadInvocationProps) {
  const data = result?.data?.tool === 'read' ? result.data : null;
  const path =
    typeof call?.args?.['path'] === 'string'
      ? (call.args['path'] as string)
      : (data?.path ?? '');

  const range = data
    ? `${data.fromLine}-${data.toLine} of ${data.totalLines}`
    : undefined;
  // When `path` is missing the call has already failed at the executor
  // (the tool guards `path` is required). Surfacing the tool name a
  // second time as the summary produced a "read read" row in the
  // timeline; show the rejection reason instead so the row is
  // self-explanatory at a glance.
  const summary = path
    ? range
      ? `${path} (${range})`
      : path
    : result && !result.ok
      ? (result.error ?? 'no path')
      : '(no path)';

  const errorHint = toolErrorHint(result);

  let detail: React.ReactNode = undefined;
  if (data) {
    const shown = splitLinesUpTo(data.content, MAX_LINES_VISIBLE);
    const overflow = countLines(data.content) - shown.length;
    detail = (
      <DetailPane
        label={
          data.truncated
            ? `content (${path} · truncated)`
            : `content (${path})`
        }
      >
        <div className={cn(chromeCodePanelClassName, 'max-h-96')}>
          <div className={chromeCodeGutterClassName}>
            {shown.map((_, i) => (
              <div key={i} className="leading-relaxed">
                {data.fromLine + i}
              </div>
            ))}
          </div>
          <pre className="flex-1 whitespace-pre bg-surface-raised px-2 py-1.5 font-mono text-row leading-relaxed text-text-secondary">
            {shown.join('\n')}
          </pre>
        </div>
        {overflow > 0 && (
          <div className="mt-1 text-meta italic text-text-faint">
            … {overflow} more lines
          </div>
        )}
      </DetailPane>
    );
  } else if (result && !result.ok) {
    const body = toolErrorBody(result);
    detail = (
      <DetailPane label="error" tone="danger">
        <div className="font-mono text-row text-danger whitespace-pre-wrap">
          {body}
        </div>
      </DetailPane>
    );
  }

  return (
    <InvocationShell
      title="read"
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
