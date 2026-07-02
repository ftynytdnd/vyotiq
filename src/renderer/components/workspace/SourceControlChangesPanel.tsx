/**
 * Source-control quick preview popover — split file list + diff, opens full panel.
 */

import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, GitBranch, PanelRightOpen } from 'lucide-react';
import { formatBranchSyncSuffix } from '@shared/github/formatBranchSync.js';
import { useWorkspaceGitStatus } from '../../hooks/useWorkspaceGitStatus.js';
import { useGitFileDiffPreview, useGitDiffPreviewRow } from '../../hooks/useGitFileDiffPreview.js';
import { useSourceControlStore } from '../../store/useSourceControlStore.js';
import { openWorkspaceFile } from '../../lib/openPath.js';
import { ComposerPickerHead } from '../composer/picker/ComposerPickerPanel.js';
import { SourceControlDiffPane } from '../sourceControl/SourceControlDiffPane.js';
import {
  SourceControlFileList,
  collectChangedFolderPaths
} from '../sourceControl/SourceControlFileList.js';
import { buildSourceControlRows, type SourceControlFileRow } from '../sourceControl/sourceControlModel.js';
import { Button } from '../ui/Button.js';
import { cn } from '../../lib/cn.js';
import { SHELL_ROW_ICON_CLASS, SHELL_ROW_ICON_STROKE } from '../../lib/shellIcons.js';
import { chromeNoMatchesClassName } from '../ui/SurfaceShell.js';

interface SourceControlChangesPanelProps {
  workspaceId: string;
  onClose: () => void;
}

export function SourceControlChangesPanel({ workspaceId, onClose }: SourceControlChangesPanelProps) {
  const { staged, unstaged, context } = useWorkspaceGitStatus(workspaceId, true);

  const { stagedRows, unstagedRows } = useMemo(
    () => buildSourceControlRows(staged, unstaged),
    [staged, unstaged]
  );

  const files = useMemo<SourceControlFileRow[]>(
    () => [...stagedRows, ...unstagedRows],
    [stagedRows, unstagedRows]
  );

  const [selected, setSelected] = useState<SourceControlFileRow | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (files.length === 0) {
      setSelected(null);
      return;
    }
    setSelected((prev) =>
      prev && files.some((f) => f.path === prev.path && f.section === prev.section) ? prev : files[0]!
    );
  }, [files]);

  useEffect(() => {
    const folders = collectChangedFolderPaths(files, { collapseDeep: files.length > 24 });
    if (folders.size === 0) return;
    setExpandedFolders((prev) => (prev.size > 0 ? prev : folders));
  }, [files]);

  const previewRow = useGitDiffPreviewRow(selected);
  const selectedPreview = useGitFileDiffPreview(workspaceId, previewRow);

  const branchLabel = context.branch ?? context.headShort ?? 'HEAD';
  const syncSuffix = formatBranchSyncSuffix(context.ahead, context.behind);

  const openFullPanel = () => {
    useSourceControlStore.getState().openPanel(workspaceId);
    onClose();
  };

  const openInEditor = () => {
    if (!selected || selected.status === 'D') return;
    void openWorkspaceFile(selected.path, { workspaceId });
    onClose();
  };

  const subtitle =
    files.length === 0
      ? 'Working tree clean'
      : [
          stagedRows.length > 0 ? `${stagedRows.length} staged` : null,
          unstagedRows.length > 0 ? `${unstagedRows.length} unstaged` : null
        ]
          .filter(Boolean)
          .join(' · ');

  return (
    <div className="vx-sc-popover flex h-[min(28rem,calc(100vh-6rem))] min-h-0 w-full min-w-0 flex-col">
      <ComposerPickerHead
        icon={
          <GitBranch
            className={cn(SHELL_ROW_ICON_CLASS, 'shrink-0 text-text-muted')}
            strokeWidth={SHELL_ROW_ICON_STROKE}
            aria-hidden
          />
        }
        title={
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <span className="truncate">{branchLabel}</span>
            {syncSuffix ? <span className="text-text-faint">{syncSuffix}</span> : null}
          </span>
        }
        subtitle={subtitle}
      />

      {files.length === 0 ? (
        <div className={cn(chromeNoMatchesClassName, 'flex flex-1 items-center justify-center px-4 py-8 text-center')}>
          No uncommitted changes.
        </div>
      ) : (
        <div className="vx-sc-popover-body min-h-0 flex-1">
          <div className="vx-sc-split min-h-0 h-full">
            <SourceControlFileList
              stagedRows={stagedRows}
              unstagedRows={unstagedRows}
              expandedFolders={expandedFolders}
              selected={selected}
              readOnly
              className="vx-sc-split-list vx-sc-changes-pane--popover"
              onFolderToggle={(path) =>
                setExpandedFolders((prev) => {
                  const next = new Set(prev);
                  if (next.has(path)) next.delete(path);
                  else next.add(path);
                  return next;
                })
              }
              onSelect={setSelected}
            />
            <SourceControlDiffPane
              className="vx-sc-split-diff"
              workspaceId={workspaceId}
              selected={selected}
              preview={selectedPreview}
              compact
              onOpenInEditor={openInEditor}
            />
          </div>
        </div>
      )}

      <footer className="vx-sc-popover-foot">
        <Button variant="accentFill" size="sm" className="shrink-0" onClick={openFullPanel}>
          <PanelRightOpen className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} aria-hidden />
          Open source control
        </Button>
        {selected && selected.status !== 'D' ? (
          <Button variant="secondary" size="sm" className="shrink-0" onClick={openInEditor}>
            <ExternalLink className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} aria-hidden />
            Open file
          </Button>
        ) : null}
      </footer>
    </div>
  );
}
