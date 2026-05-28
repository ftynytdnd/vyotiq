/**
 * Bespoke renderer for the `report` tool.
 *
 * Surfaces the title, workspace-relative path, on-disk size, and an
 * Open-in-browser affordance when settled. While the call is in flight,
 * paints the streaming HTML body as all-`+` diff lines (same rhythm as
 * `EditInvocation` create previews).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { ToolCall, ToolResult } from '@shared/types/tool.js';
import { SHELL_ROW_ICON_CLASS, SHELL_ACTION_ICON_STROKE } from '../../../lib/shellIcons.js';
import type { DiffStreamSnapshot } from '../reducer/types.js';
import { InvocationShell } from './shared/InvocationShell.js';
import { DetailPane } from './shared/DetailPane.js';
import { DiffStreamPane } from './shared/DiffStreamPane.js';
import { EditDiffView } from './edit/EditDiffView.js';
import { synthesizeReportPreview } from './report/synthesizeReportPreview.js';
import { cn } from '../../../lib/cn.js';
import { timelineActionPillClassName } from '../shared/rowStyles.js';
import { openWorkspaceFile } from '../../../lib/openPath.js';
import { toolErrorBody, toolErrorHint } from './shared/toolErrorDisplay.js';
import { useChatStore } from '../../../store/useChatStore.js';
import { useConversationsStore } from '../../../store/useConversationsStore.js';

interface ReportInvocationProps {
  call?: ToolCall;
  result?: ToolResult;
  dense?: boolean;
  rowKey?: string;
  partial?: boolean;
  diffStream?: DiffStreamSnapshot;
}

export function ReportInvocation({
  call,
  result,
  dense,
  rowKey,
  partial,
  diffStream
}: ReportInvocationProps) {
  const data = result?.data?.tool === 'report' ? result.data : null;
  const argTitle =
    typeof call?.args?.['title'] === 'string' ? (call.args['title'] as string) : '';

  const title = data?.title ?? argTitle ?? 'report';
  const summary = title;

  const preview = useMemo(
    () => (!result && call?.args ? synthesizeReportPreview(call.args) : null),
    [result, call?.args]
  );
  const visibleDiffStream =
    diffStream && diffStream.tool === 'report' && diffStream.hunks.length > 0
      ? diffStream
      : null;

  const errorHint = toolErrorHint(result);

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
  } else if (result && !result.ok) {
    detail = (
      <DetailPane label="error" tone="danger">
        <div className="font-mono text-row text-danger whitespace-pre-wrap">
          {toolErrorBody(result)}
        </div>
      </DetailPane>
    );
  } else if (visibleDiffStream) {
    detail = (
      <DiffStreamPane
        diffStream={visibleDiffStream}
        label={visibleDiffStream.settled ? 'live report' : 'streaming report'}
      />
    );
  } else if (preview) {
    detail = (
      <DetailPane label={partial ? 'report streaming…' : 'report (pending)'}>
        <EditDiffView
          key={partial ? 'report-partial' : 'report-pending'}
          hunks={preview.hunks}
          variant={partial ? 'partial' : 'preview'}
        />
      </DetailPane>
    );
  }

  return (
    <InvocationShell
      title="report"
      summary={summary}
      ok={result ? result.ok : null}
      {...(errorHint ? { errorHint } : {})}
      {...(detail !== undefined ? { detail } : {})}
      {...(dense ? { dense } : {})}
      {...(rowKey ? { rowKey } : {})}
      call={call}
      result={result}
      partial={partial}
    />
  );
}

interface OpenInBrowserButtonProps {
  filePath: string;
}

function OpenInBrowserButton({ filePath }: OpenInBrowserButtonProps) {
  const [busy, setBusy] = useState(false);
  const mountedRef = useRef(true);
  const activeConvId = useChatStore((s) => s.conversationId);
  const workspaceId = useConversationsStore((s) =>
    activeConvId ? s.list.find((m) => m.id === activeConvId)?.workspaceId : undefined
  );

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await openWorkspaceFile(filePath, {
        ...(workspaceId ? { workspaceId } : {}),
        context: 'report-card'
      });
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void onClick()}
      disabled={busy}
      className={cn(
        timelineActionPillClassName,
        'app-no-drag self-start px-2.5 py-1 text-text-primary',
        'disabled:cursor-not-allowed disabled:opacity-50'
      )}
      title={`Open ${filePath} in your default browser`}
    >
      <ExternalLink className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
      Open in browser
    </button>
  );
}

function SizeBadge({ bytes }: { bytes: number }) {
  const text =
    bytes >= 1024 * 1024
      ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
      : `${(bytes / 1024).toFixed(1)} KB`;
  return (
    <span className="rounded-inner border border-border-subtle/25 px-1.5 py-0.5 font-mono text-meta text-text-faint">
      {text}
    </span>
  );
}
