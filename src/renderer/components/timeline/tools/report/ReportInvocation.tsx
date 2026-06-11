/**
 * Bespoke renderer for the `report` tool — shows title, saved path,
 * and an open-in-browser action with optional auto-open.
 */

import { useEffect } from 'react';
import { ArrowUpRight, FileText } from 'lucide-react';
import type { ToolCall, ToolResult } from '@shared/types/tool.js';
import type { DiffStreamSnapshot } from '../../reducer/types.js';
import { InvocationShell } from '../shared/InvocationShell.js';
import { DetailPane } from '../shared/DetailPane.js';
import { DiffStreamPane } from '../shared/DiffStreamPane.js';
import { toolErrorBody, toolErrorHint } from '../shared/toolErrorDisplay.js';
import { openWorkspaceFile } from '../../../../lib/openPath.js';
import { useWorkspaceStore } from '../../../../store/useWorkspaceStore.js';
import { useConversationsStore } from '../../../../store/useConversationsStore.js';
import { useChatStore } from '../../../../store/useChatStore.js';
import { useSettingsStore } from '../../../../store/useSettingsStore.js';
import { resolveReportsSettings } from '@shared/report/reportsSettings.js';
import { consumeLiveReportAutoOpen } from './reportAutoOpenSession.js';
import { SHELL_ROW_ICON_CLASS, SHELL_ROW_ICON_STROKE } from '../../../../lib/shellIcons.js';
import { timelineActionPillClassName } from '../../shared/rowStyles.js';
import { cn } from '../../../../lib/cn.js';

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
  const title =
    (typeof call?.args?.['title'] === 'string' ? (call.args['title'] as string) : null) ??
    data?.title ??
    'Report';
  const relPath =
    data?.relPath ??
    (typeof diffStream?.filePath === 'string' ? diffStream.filePath : undefined);

  const conversationId = useChatStore((s) => s.conversationId);
  const liveReportResultIds = useChatStore((s) => s.liveReportResultIds);
  const reports = resolveReportsSettings(useSettingsStore((s) => s.settings.ui));
  const workspaceId = useConversationsStore((s) => {
    if (!conversationId) return null;
    return s.list.find((m) => m.id === conversationId)?.workspaceId ?? null;
  });
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeId);
  const openWorkspaceId = workspaceId ?? activeWorkspaceId ?? undefined;

  useEffect(() => {
    if (partial || !result?.ok || !relPath || !reports.autoOpenReports) return;
    const callId = result.id;
    if (!callId || !liveReportResultIds[callId]) return;
    if (!consumeLiveReportAutoOpen(callId)) return;
    void openWorkspaceFile(relPath, {
      workspaceId: openWorkspaceId,
      kind: 'report',
      context: 'report-auto',
      title
    });
  }, [
    partial,
    relPath,
    result?.id,
    result?.ok,
    openWorkspaceId,
    reports.autoOpenReports,
    title,
    liveReportResultIds
  ]);

  const summary = partial
    ? `writing "${title}"…`
    : data
      ? `${title} — ${data.bytes.toLocaleString()} bytes`
      : title;

  const errorHint = toolErrorHint(result);

  let detail: React.ReactNode = undefined;
  if (diffStream?.hunks && diffStream.hunks.length > 0) {
    detail = <DiffStreamPane diffStream={diffStream} label="streaming report" />;
  } else if (result && !result.ok) {
    detail = (
      <DetailPane label="error" tone="danger">
        <div className="font-mono text-row text-danger whitespace-pre-wrap">
          {toolErrorBody(result)}
        </div>
      </DetailPane>
    );
  } else if (relPath) {
    detail = (
      <DetailPane label="saved path">
        <div className="font-mono text-row text-text-secondary">{relPath}</div>
        {reports.autoOpenReports ? (
          <p className="mt-1 font-mono text-meta text-text-faint">
            {reports.openInAppBrowser
              ? 'Opens automatically in Vyotiq report window'
              : 'Opens automatically in your system browser'}
          </p>
        ) : null}
      </DetailPane>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      <InvocationShell
        title="report"
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
      {result?.ok && relPath && (
        <button
          type="button"
          onClick={() =>
            void openWorkspaceFile(relPath, {
              workspaceId: openWorkspaceId,
              kind: 'report',
              context: 'report',
              title
            })
          }
          className={cn(timelineActionPillClassName, 'self-start gap-1')}
          title={
            reports.openInAppBrowser
              ? 'Open in Vyotiq report window'
              : 'Open in system browser'
          }
        >
          <FileText className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} aria-hidden />
          Open report
          <ArrowUpRight
            className={SHELL_ROW_ICON_CLASS}
            strokeWidth={SHELL_ROW_ICON_STROKE}
            aria-hidden
          />
        </button>
      )}
    </div>
  );
}
