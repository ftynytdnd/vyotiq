/**
 * Checkpoints view — full history page. Tabbed: "Runs" (list of every
 * agent run) and "Files" (per-file history). Surfaced as a Modal so
 * it can be opened from the sidebar without disturbing the chat
 * surface.
 */

import { useEffect, useMemo, useState } from 'react';
import { History, Files as FilesIcon } from 'lucide-react';
import { Modal } from '../ui/Modal.js';
import { useCheckpointsStore } from '../../store/useCheckpointsStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { RunCheckpointCard } from './RunCheckpointCard.js';
import { FileHistoryList } from './FileHistoryList.js';
import { formatTimestamp } from './formatTimestamp.js';
import { cn } from '../../lib/cn.js';

interface CheckpointsViewProps {
  open: boolean;
  onClose: () => void;
}

type Tab = 'runs' | 'files';

export function CheckpointsView({ open, onClose }: CheckpointsViewProps) {
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

  useEffect(() => {
    if (!open || !activeWorkspaceId) return;
    void refreshSummary(activeWorkspaceId);
  }, [open, activeWorkspaceId, refreshSummary]);

  // Reset the file pick when we leave the files tab.
  useEffect(() => {
    if (tab !== 'files') setFilePicked(null);
  }, [tab]);

  const usage = summary?.usage;
  const formattedSize = useMemo(() => formatBytes(usage?.totalBytes ?? 0), [usage?.totalBytes]);

  return (
    <Modal open={open} onClose={onClose} title="Checkpoints" size="lg">
      <div className="flex min-h-[420px] flex-col">
        {/* Tab strip */}
        <div className="mb-3 flex items-center gap-1">
          <TabButton active={tab === 'runs'} onClick={() => setTab('runs')}>
            <History className="h-3.5 w-3.5" strokeWidth={2} />
            Runs
          </TabButton>
          <TabButton active={tab === 'files'} onClick={() => setTab('files')}>
            <FilesIcon className="h-3.5 w-3.5" strokeWidth={2} />
            Files
          </TabButton>
          <div className="ml-auto text-meta text-text-muted">
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
          />
        )}

        {activeWorkspaceId && tab === 'files' && filePicked === null && (
          <FilesTab
            workspaceId={activeWorkspaceId}
            summary={summary}
            loading={loading}
            onPick={setFilePicked}
          />
        )}

        {activeWorkspaceId && tab === 'files' && filePicked !== null && (
          <FileHistoryList
            workspaceId={activeWorkspaceId}
            filePath={filePicked}
            onBack={() => setFilePicked(null)}
          />
        )}
      </div>
    </Modal>
  );
}

function TabButton({
  active,
  onClick,
  children
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'app-no-drag inline-flex items-center gap-1.5 rounded-inner px-2.5 py-1 text-row',
        'transition-colors duration-150',
        active
          ? 'bg-surface-overlay text-text-primary'
          : 'text-text-muted hover:text-text-primary'
      )}
    >
      {children}
    </button>
  );
}

function RunsTab({
  workspaceId,
  summary,
  loading
}: {
  workspaceId: string;
  summary: ReturnType<typeof useCheckpointsStore.getState>['summaryByWorkspace'][string] | undefined;
  loading: boolean;
}) {
  if (loading && !summary) {
    return <div className="text-row text-text-faint">Loading runs…</div>;
  }
  if (!summary || summary.runs.length === 0) {
    return (
      <div className="text-row text-text-muted">
        No agent runs have produced checkpoints yet.
      </div>
    );
  }
  return (
    <ul className="scrollbar-stealth flex max-h-[52vh] flex-col gap-2 overflow-y-auto pr-1">
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
  onPick
}: {
  workspaceId: string;
  summary: ReturnType<typeof useCheckpointsStore.getState>['summaryByWorkspace'][string] | undefined;
  loading: boolean;
  onPick: (filePath: string) => void;
}) {
  if (loading && !summary) {
    return <div className="text-row text-text-faint">Loading files…</div>;
  }
  if (!summary || summary.files.length === 0) {
    return (
      <div className="text-row text-text-muted">
        No file changes have been recorded yet.
      </div>
    );
  }
  return (
    <ul className="scrollbar-stealth flex max-h-[52vh] flex-col gap-0.5 overflow-y-auto rounded-inner bg-surface-raised/60 p-1">
      {summary.files.map((f) => (
        <li key={f.filePath}>
          <button
            type="button"
            onClick={() => onPick(f.filePath)}
            className={cn(
              'app-no-drag log-line flex w-full items-center gap-2 rounded-inner px-2 py-1 text-left',
              'transition-colors duration-150 hover:bg-surface-hover'
            )}
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

function formatBytes(n: number): string {
  if (n === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
}
