/**
 * Checkpoints history — tabbed Runs and Files views for the secondary zone.
 */

import { useEffect, useMemo, useState } from 'react';
import { History, Files as FilesIcon } from 'lucide-react';
import { Spinner } from '../ui/Spinner.js';
import { Tabs, type TabItem } from '../ui/Tabs.js';
import { useCheckpointsStore } from '../../store/useCheckpointsStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { useSecondaryZoneStore } from '../../store/useSecondaryZoneStore.js';
import { RunCheckpointCard } from './RunCheckpointCard.js';
import { FileHistoryList } from './FileHistoryList.js';
import { formatTimestamp } from './formatTimestamp.js';
import { formatBytes } from './formatBytes.js';
import { cn } from '../../lib/cn.js';
import { surfaceListClassName } from '../ui/SurfaceShell.js';
import { timelineRowHeaderClassName } from '../timeline/shared/rowStyles.js';

type Tab = 'runs' | 'files';

/** Checkpoints history body for the secondary zone or modal shell. */
export function CheckpointsPanel({ embedded = false }: { embedded?: boolean }) {
  const [tab, setTab] = useState<Tab>('runs');
  const [filePicked, setFilePicked] = useState<string | null>(null);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeId);
  const refreshSummary = useCheckpointsStore((s) => s.refreshSummary);
  const summary = useCheckpointsStore((s) =>
    activeWorkspaceId ? s.summaryByWorkspace[activeWorkspaceId] : undefined
  );
  const loading = useCheckpointsStore((s) =>
    activeWorkspaceId ? s.summaryLoading[activeWorkspaceId] === true : false
  );
  const openCheckpointSettings = useSecondaryZoneStore((s) => s.openSettings);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    void refreshSummary(activeWorkspaceId);
  }, [activeWorkspaceId, refreshSummary]);

  useEffect(() => {
    if (tab !== 'files') setFilePicked(null);
  }, [tab]);

  const usage = summary?.usage;
  const formattedSize = useMemo(() => formatBytes(usage?.totalBytes ?? 0), [usage?.totalBytes]);

  const tabItems: TabItem<Tab>[] = [
    {
      id: 'runs',
      label: 'Runs',
      icon: <History className="h-3.5 w-3.5" strokeWidth={2} />
    },
    {
      id: 'files',
      label: 'Files',
      icon: <FilesIcon className="h-3.5 w-3.5" strokeWidth={2} />
    }
  ];

  const listMaxClass = embedded
    ? 'scrollbar-stealth flex max-h-none min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1'
    : 'scrollbar-stealth flex max-h-[52vh] flex-col gap-2 overflow-y-auto pr-1';

  return (
    <div className={cn('flex flex-col', embedded ? 'min-h-0 flex-1' : 'min-h-[420px]')}>
      <div className="mb-2">
        <button
          type="button"
          onClick={() => openCheckpointSettings('checkpoints')}
          className="text-row text-text-secondary transition-colors hover:text-text-primary"
        >
          Open checkpoint settings…
        </button>
      </div>
      <div className="mb-3 flex min-w-0 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-1">
        <Tabs<Tab>
          items={tabItems}
          value={tab}
          onChange={setTab}
          variant="strip"
          ariaLabel="Checkpoints view"
        />
        <div className="min-w-0 truncate text-meta text-text-muted sm:ml-auto">
          {usage
            ? `${usage.runCount} run${usage.runCount === 1 ? '' : 's'} · ${usage.fileCount} file${usage.fileCount === 1 ? '' : 's'} · ${formattedSize}`
            : ''}
        </div>
      </div>

      {!activeWorkspaceId && (
        <div className="text-row text-text-muted">
          Select a workspace to view its checkpoints.
        </div>
      )}

      {activeWorkspaceId && tab === 'runs' && (
        <RunsTab
          workspaceId={activeWorkspaceId}
          summary={summary}
          loading={loading}
          listClassName={listMaxClass}
        />
      )}

      {activeWorkspaceId && tab === 'files' && filePicked === null && (
        <FilesTab
          workspaceId={activeWorkspaceId}
          summary={summary}
          loading={loading}
          onPick={setFilePicked}
          listClassName={embedded
            ? cn('scrollbar-stealth max-h-none min-h-0 flex-1', surfaceListClassName)
            : cn('scrollbar-stealth max-h-[52vh]', surfaceListClassName)}
        />
      )}

      {activeWorkspaceId && tab === 'files' && filePicked !== null && (
        <FileHistoryList
          workspaceId={activeWorkspaceId}
          filePath={filePicked}
          embedded={embedded}
          onBack={() => setFilePicked(null)}
        />
      )}
    </div>
  );
}

function RunsTab({
  workspaceId,
  summary,
  loading,
  listClassName = 'scrollbar-stealth flex max-h-[52vh] flex-col gap-2 overflow-y-auto pr-1'
}: {
  workspaceId: string;
  summary: ReturnType<typeof useCheckpointsStore.getState>['summaryByWorkspace'][string] | undefined;
  loading: boolean;
  listClassName?: string;
}) {
  if (loading && !summary) {
    return (
      <div className="flex items-center gap-2 text-row text-text-muted">
        <Spinner /> Loading runs…
      </div>
    );
  }
  if (!summary || summary.runs.length === 0) {
    return (
      <div className="text-row text-text-muted">
        No agent runs have produced checkpoints yet.
      </div>
    );
  }
  return (
    <ul className={listClassName}>
      {summary.runs.map((r) => (
        <li key={r.runId}>
          <RunCheckpointCard workspaceId={workspaceId} runHead={r} />
        </li>
      ))}
    </ul>
  );
}

function FilesTab({
  summary,
  loading,
  onPick,
  listClassName = cn('scrollbar-stealth max-h-[52vh]', surfaceListClassName)
}: {
  workspaceId: string;
  summary: ReturnType<typeof useCheckpointsStore.getState>['summaryByWorkspace'][string] | undefined;
  loading: boolean;
  onPick: (filePath: string) => void;
  listClassName?: string;
}) {
  if (loading && !summary) {
    return (
      <div className="flex items-center gap-2 text-row text-text-muted">
        <Spinner /> Loading files…
      </div>
    );
  }
  if (!summary || summary.files.length === 0) {
    return (
      <div className="text-row text-text-muted">
        No file changes have been recorded yet.
      </div>
    );
  }
  return (
    <ul className={listClassName}>
      {summary.files.map((f) => (
        <li key={f.filePath}>
          <button
            type="button"
            onClick={() => onPick(f.filePath)}
            className={cn(timelineRowHeaderClassName, 'text-left')}
          >
            <FilePathText filePath={f.filePath} />
            <div className="shrink-0 text-right text-meta text-text-muted">
              {f.changeCount} change{f.changeCount === 1 ? '' : 's'} ·{' '}
              {formatTimestamp(f.lastChangeAt)}
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

function FilePathText({ filePath }: { filePath: string }) {
  const pathIndex = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  const fileName = pathIndex >= 0 ? filePath.slice(pathIndex + 1) : filePath;
  const dirName = pathIndex >= 0 ? filePath.slice(0, pathIndex + 1) : '';

  return (
    <div className="min-w-0 flex-1 truncate text-row" title={filePath}>
      {dirName && <span className="font-mono text-text-faint">{dirName}</span>}
      <span className="font-mono text-text-primary">{fileName}</span>
    </div>
  );
}
