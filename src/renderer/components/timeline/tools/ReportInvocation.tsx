/**
 * Bespoke renderer for the `report` tool.
 *
 * Surfaces the title, workspace-relative path, on-disk size, and chart
 * library badge in the collapsed row. The expanded detail pane carries
 * an explicit "Open in browser" button that hands the file to the OS
 * default browser via the existing `tools.openPath` IPC channel —
 * `tools.ipc.ts` already enforces symlink-aware sandbox containment on
 * that handler, so we don't need to re-validate here.
 *
 * Errors render the standard `error` detail pane the other tool cards
 * use, keeping the failure surface consistent with `EditInvocation` etc.
 */

import { useState } from 'react';
import { ExternalLink, FileText } from 'lucide-react';
import type { ToolCall, ToolResult } from '@shared/types/tool.js';
import { InvocationShell } from './shared/InvocationShell.js';
import { DetailPane } from './shared/DetailPane.js';
import { CodeBlock } from './shared/CodeBlock.js';
import { cn } from '../../../lib/cn.js';
import { openWorkspaceFile } from '../../../lib/openPath.js';
import { useChatStore } from '../../../store/useChatStore.js';
import { useConversationsStore } from '../../../store/useConversationsStore.js';

interface ReportInvocationProps {
  call?: ToolCall;
  result?: ToolResult;
  dense?: boolean;
  rowKey?: string;
}

export function ReportInvocation({ call, result, dense, rowKey }: ReportInvocationProps) {
  const data = result?.data?.tool === 'report' ? result.data : null;
  const argTitle =
    typeof call?.args?.['title'] === 'string' ? (call.args['title'] as string) : '';

  const title = data?.title ?? argTitle ?? 'report';

  // Collapsed-row summary: just the title (mono looks wrong for a
  // human-authored title; we keep it sans-serif).
  const summary = title;

  const errorHint = result && !result.ok ? result.error : undefined;

  let detail: React.ReactNode = undefined;
  if (data) {
    detail = (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-row text-text-muted">
          <span className="font-mono truncate" title={data.filePath}>
            {data.filePath}
          </span>
          <SizeBadge bytes={data.sizeBytes} />
        </div>
        <DetailPane label="open">
          <OpenInBrowserButton filePath={data.filePath} />
        </DetailPane>
      </div>
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
      Icon={FileText}
      title="report"
      summary={summary}
      ok={result ? result.ok : null}
      {...(errorHint ? { errorHint } : {})}
      {...(detail !== undefined ? { detail } : {})}
      {...(dense ? { dense } : {})}
      {...(rowKey ? { rowKey } : {})}
    />
  );
}

interface OpenInBrowserButtonProps {
  filePath: string;
}

function OpenInBrowserButton({ filePath }: OpenInBrowserButtonProps) {
  const [busy, setBusy] = useState(false);
  // Pin the open to the active conversation's workspace so a report
  // produced in workspace A still opens correctly when the user has
  // navigated to workspace B (and B happens to have a same-relative
  // file under `.vyotiq/reports/`). Failures bubble through a toast
  // via `openWorkspaceFile`, replacing the previous inline error
  // banner — the toast is global and visually consistent with every
  // other artifact-open in the app.
  const activeConvId = useChatStore((s) => s.conversationId);
  const workspaceId = useConversationsStore((s) =>
    activeConvId ? s.list.find((m) => m.id === activeConvId)?.workspaceId : undefined
  );

  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await openWorkspaceFile(filePath, {
        ...(workspaceId ? { workspaceId } : {}),
        context: 'report-card'
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void onClick()}
      disabled={busy}
      className={cn(
        'app-no-drag inline-flex items-center gap-1.5 self-start rounded-inner',
        'bg-surface-raised px-2.5 py-1 text-row text-text-primary',
        'transition-colors duration-150 hover:bg-surface-hover',
        'disabled:cursor-not-allowed disabled:opacity-50'
      )}
      title={`Open ${filePath} in your default browser`}
    >
      <ExternalLink className="h-3 w-3" strokeWidth={2.25} />
      Open in browser
    </button>
  );
}

function SizeBadge({ bytes }: { bytes: number }) {
  // Compact, human-readable: <1 MB → KB, ≥1 MB → MB.
  const text =
    bytes >= 1024 * 1024
      ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
      : `${(bytes / 1024).toFixed(1)} KB`;
  return (
    <span className="rounded bg-surface-overlay px-1.5 py-0.5 text-meta font-mono text-text-faint">
      {text}
    </span>
  );
}
