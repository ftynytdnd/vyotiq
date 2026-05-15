/**
 * Bespoke renderer for the `ls` tool. Presents the directory listing as a
 * compact file/folder table in the expanded detail.
 */

import { FolderTree, Folder, FileText } from 'lucide-react';
import type { ToolCall, ToolResult } from '@shared/types/tool.js';
import { InvocationShell } from './shared/InvocationShell.js';
import { DetailPane } from './shared/DetailPane.js';

interface LsInvocationProps {
  call?: ToolCall;
  result?: ToolResult;
  dense?: boolean;
  rowKey?: string;
}

const MAX_ENTRIES_VISIBLE = 200;

export function LsInvocation({ call, result, dense, rowKey }: LsInvocationProps) {
  const data = result?.data?.tool === 'ls' ? result.data : null;
  const path =
    typeof call?.args?.['path'] === 'string' && call.args['path']
      ? (call.args['path'] as string)
      : (data?.path ?? '.');

  const count = data?.entries.length ?? 0;
  const summary = data
    ? `${path} — ${count} entr${count === 1 ? 'y' : 'ies'}${data.truncated ? ' (truncated)' : ''}`
    : `ls ${path}`;

  const errorHint = result && !result.ok ? result.error : undefined;

  const detail = data ? (
    <DetailPane label={`listing (depth ${data.depth})`}>
      <div className="scrollbar-stealth flex max-h-52 flex-col overflow-auto rounded-inner bg-surface-raised/60 px-2 py-1.5">
        {data.entries.slice(0, MAX_ENTRIES_VISIBLE).map((e) => (
          <div
            key={e.rel}
            className="flex items-center gap-1.5 font-mono text-row text-text-secondary"
          >
            {e.type === 'dir' ? (
              <Folder className="h-3 w-3 shrink-0 text-accent" strokeWidth={2} />
            ) : (
              <FileText className="h-3 w-3 shrink-0 text-text-faint" strokeWidth={2} />
            )}
            <span className="truncate" title={e.rel}>
              {e.rel}
            </span>
          </div>
        ))}
        {data.entries.length > MAX_ENTRIES_VISIBLE && (
          <div className="mt-1 text-meta italic text-text-faint">
            … {data.entries.length - MAX_ENTRIES_VISIBLE} more
          </div>
        )}
      </div>
    </DetailPane>
  ) : result && !result.ok ? (
    // Defect 2 fix: surface the actionable message (`result.output`)
    // here instead of the short `result.error` tag. The
    // collapsed-row `errorHint` slot still carries the tag for the
    // one-line breadcrumb.
    <DetailPane label="error" tone="danger">
      <div className="font-mono text-row text-danger whitespace-pre-wrap">
        {result.output && result.output.length > 0
          ? result.output
          : (result.error ?? '')}
      </div>
    </DetailPane>
  ) : undefined;

  return (
    <InvocationShell
      Icon={FolderTree}
      title="ls"
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
