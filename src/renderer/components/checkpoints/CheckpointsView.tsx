/**
 * Checkpoints history — tabbed Runs and Files views for the secondary zone.
 */

import { useEffect, useMemo, useState } from 'react';
import { History, Files as FilesIcon, ClipboardCheck } from 'lucide-react';
import { LoadingHint } from '../ui/LoadingHint.js';
import { LeftSubnav, LeftSubnavLayout, type LeftSubnavItem } from '../ui/LeftSubnav.js';
import { useCheckpointsStore, usePendingChanges } from '../../store/useCheckpointsStore.js';
import { useChatStore } from '../../store/useChatStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { useSecondaryZoneStore, type CheckpointsTab } from '../../store/useSecondaryZoneStore.js';
import { RunCheckpointCard } from './RunCheckpointCard.js';
import { FileHistoryList } from './FileHistoryList.js';
import { CheckpointsReviewTab } from './CheckpointsReviewTab.js';
import { formatTimestamp } from './formatTimestamp.js';
import { formatBytes } from './formatBytes.js';
import { cn } from '../../lib/cn.js';
import { SHELL_TAB_ICON_CLASS, SHELL_TAB_ICON_STROKE } from '../../lib/shellIcons.js';
import {
  chromeListEmptyClassName,
  secondaryZonePanelContentClassName
} from '../ui/SurfaceShell.js';
import { ShellStack } from '../ui/ShellSection.js';

type Tab = CheckpointsTab;

/** Checkpoints history body for the secondary zone. */
export function CheckpointsPanel({ embedded = false }: { embedded?: boolean }) {
  const conversationId = useChatStore((s) => s.conversationId);
  const pending = usePendingChanges(conversationId);
  const checkpointsTab = useSecondaryZoneStore((s) => s.checkpointsTab);
  const [tab, setTab] = useState<Tab>(checkpointsTab);
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
    setTab(checkpointsTab);
  }, [checkpointsTab]);

  useEffect(() => {
    if (checkpointsTab !== 'runs') return;
    setTab(pending.length > 0 ? 'review' : 'runs');
  }, [conversationId, pending.length, checkpointsTab]);

  useEffect(() => {
    if (tab !== 'files') setFilePicked(null);
  }, [tab]);

  const usage = summary?.usage;
  const formattedSize = useMemo(() => formatBytes(usage?.totalBytes ?? 0), [usage?.totalBytes]);

  const navItems: LeftSubnavItem<Tab>[] = [
    {
      id: 'runs',
      label: 'Runs',
      tabId: 'checkpoints-tab-runs',
      panelId: 'checkpoints-panel-runs',
      icon: <History className={SHELL_TAB_ICON_CLASS} strokeWidth={SHELL_TAB_ICON_STROKE} />
    },
    {
      id: 'files',
      label: 'Files',
      tabId: 'checkpoints-tab-files',
      panelId: 'checkpoints-panel-files',
      icon: <FilesIcon className={SHELL_TAB_ICON_CLASS} strokeWidth={SHELL_TAB_ICON_STROKE} />
    },
    {
      id: 'review',
      label: 'Review',
      tabId: 'checkpoints-tab-review',
      panelId: 'checkpoints-panel-review',
      icon: <ClipboardCheck className={SHELL_TAB_ICON_CLASS} strokeWidth={SHELL_TAB_ICON_STROKE} />
    }
  ];

  const listMaxClass = embedded
    ? 'scrollbar-stealth flex max-h-none min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1'
    : 'scrollbar-stealth flex max-h-[52vh] flex-col gap-2 overflow-y-auto pr-1';

  return (
    <ShellStack
      className={cn(
        embedded ? 'min-h-0 flex-1' : 'min-h-[420px]',
        embedded && secondaryZonePanelContentClassName
      )}
    >
      <div>
        <button
          type="button"
          onClick={() => openCheckpointSettings('checkpoints')}
          className="vx-btn vx-btn-text"
        >
          Open checkpoint settings…
        </button>
      </div>

      {!activeWorkspaceId && (
        <div className={chromeListEmptyClassName}>
          Select a workspace to view its checkpoints.
        </div>
      )}

      {activeWorkspaceId && (
        <LeftSubnavLayout
          className="min-h-0 flex-1"
          contentClassName="scrollbar-stealth min-h-0 overflow-y-auto"
          nav={
            <LeftSubnav<Tab>
              items={navItems}
              value={tab}
              onChange={setTab}
              ariaLabel="Checkpoints view"
              footer={
                usage ? (
                  <div className="mt-2 px-2 text-meta text-text-faint">
                    {usage.runCount} run{usage.runCount === 1 ? '' : 's'} ·{' '}
                    {usage.fileCount} file{usage.fileCount === 1 ? '' : 's'} · {formattedSize}
                  </div>
                ) : undefined
              }
            />
          }
        >
          <div
            role="tabpanel"
            id={`checkpoints-panel-${tab}`}
            aria-labelledby={`checkpoints-tab-${tab}`}
            className="min-h-0"
          >
            {tab === 'runs' && (
              <RunsTab
                workspaceId={activeWorkspaceId}
                summary={summary}
                loading={loading}
                listClassName={listMaxClass}
              />
            )}

            {tab === 'files' && filePicked === null && (
              <FilesTab
                workspaceId={activeWorkspaceId}
                summary={summary}
                loading={loading}
                onPick={setFilePicked}
                listClassName={
                  embedded
                    ? cn('scrollbar-stealth max-h-none min-h-0 flex-1 vx-memory-list')
                    : cn('scrollbar-stealth max-h-[52vh] vx-memory-list')
                }
              />
            )}

            {tab === 'files' && filePicked !== null && (
              <FileHistoryList
                workspaceId={activeWorkspaceId}
                filePath={filePicked}
                embedded={embedded}
                onBack={() => setFilePicked(null)}
              />
            )}

            {tab === 'review' && <CheckpointsReviewTab />}
          </div>
        </LeftSubnavLayout>
      )}
    </ShellStack>
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
    return <LoadingHint message="Loading runs…" className="py-4" />;
  }
  if (!summary || summary.runs.length === 0) {
    return (
      <div className={chromeListEmptyClassName}>
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
  listClassName = cn('scrollbar-stealth max-h-[52vh] vx-memory-list')
}: {
  workspaceId: string;
  summary: ReturnType<typeof useCheckpointsStore.getState>['summaryByWorkspace'][string] | undefined;
  loading: boolean;
  onPick: (filePath: string) => void;
  listClassName?: string;
}) {
  if (loading && !summary) {
    return <LoadingHint message="Loading files…" className="py-4" />;
  }
  if (!summary || summary.files.length === 0) {
    return (
      <div className={chromeListEmptyClassName}>
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
            data-active="false"
            className="vx-memory-list-item flex w-full min-w-0 items-center gap-2 text-left"
          >
            <FilePathText filePath={f.filePath} />
            <div className="shrink-0 text-right vx-caption">
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
