/**
 * Interactive workspace / VCS / chat context — landing strip and titlebar breadcrumb.
 */

import { useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { FolderOpen, GitBranch } from 'lucide-react';
import type { WorkspaceGitContext } from '@shared/types/ipc.js';
import { formatBranchSyncSuffix } from '@shared/github/formatBranchSync.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { useWorkspaceGitContext } from '../../hooks/useWorkspaceGitStatus.js';
import { openDockChats, openDockNavigator } from '../dock/dockShared.js';
import { BranchPickerPanel } from '../composer/branchPicker/ComposerBranchChip.js';
import { SourceControlChangesPanel } from './SourceControlChangesPanel.js';
import { useSourceControlStore } from '../../store/useSourceControlStore.js';
import { Popover } from '../ui/Popover.js';
import { readTitlebarInsetPx } from '../ui/popoverPosition.js';
import { CHROME_LAYER_TITLEBAR_POPOVER } from '../titlebar/titlebarShared.js';
import { cn } from '../../lib/cn.js';
import { SHELL_ROW_ICON_CLASS, SHELL_ROW_ICON_STROKE } from '../../lib/shellIcons.js';

function formatBranchLabel(context: WorkspaceGitContext, fallbackBranch?: string | null): string {
  if (context.isRepo) {
    const ref = context.branch ?? context.headShort ?? 'HEAD';
    if (context.branch) {
      return `${ref}${formatBranchSyncSuffix(context.ahead, context.behind)}`;
    }
    return ref;
  }
  return fallbackBranch ?? 'Local';
}

function ContextSeparator() {
  return (
    <span className="select-none px-0.5 text-text-faint" aria-hidden>
      ·
    </span>
  );
}

function ContextChip({
  label,
  title,
  onClick,
  icon,
  className,
  ariaLabel
}: {
  label: string;
  title: string;
  onClick: () => void;
  icon?: ReactNode;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel ?? label}
      className={cn(
        'vx-workspace-context-chip inline-flex max-w-[14rem] items-center gap-1 truncate rounded-inner px-1.5 py-0.5 font-mono text-meta text-text-faint transition-colors hover:bg-chrome-hover-soft hover:text-text-secondary',
        className
      )}
      title={title}
      onClick={onClick}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}

interface WorkspaceContextBarProps {
  workspaceId: string;
  workspaceLabel: string;
  /** Titlebar breadcrumb — include chat title segment. */
  variant?: 'landing' | 'breadcrumb';
  chatTitle?: string | null;
  className?: string;
}

export function WorkspaceContextBar({
  workspaceId,
  workspaceLabel,
  variant = 'landing',
  chatTitle = null,
  className
}: WorkspaceContextBarProps) {
  const enabled = variant === 'landing' || variant === 'breadcrumb';
  const gitContext = useWorkspaceGitContext(workspaceId, enabled);
  const workspace = useWorkspaceStore((s) => s.list.find((w) => w.id === workspaceId));
  const githubBranch = workspace?.github?.branch;
  const hasGitHubBinding = Boolean(workspace?.github);

  const [branchOpen, setBranchOpen] = useState(false);
  const [changesOpen, setChangesOpen] = useState(false);
  const branchTriggerRef = useRef<HTMLButtonElement>(null);
  const changesTriggerRef = useRef<HTMLButtonElement>(null);

  const branchLabel = useMemo(
    () => formatBranchLabel(gitContext, githubBranch),
    [gitContext, githubBranch]
  );

  const dirtyCount = gitContext.dirtyCount;
  const dirtyLabel =
    dirtyCount > 0 ? `${dirtyCount} ${dirtyCount === 1 ? 'change' : 'changes'}` : null;

  const onWorkspace = () => openDockNavigator();
  const onBranch = () => {
    if (hasGitHubBinding) {
      setBranchOpen((o) => !o);
      return;
    }
    if (gitContext.isRepo) {
      useSourceControlStore.getState().openPanel(workspaceId);
      return;
    }
    openDockNavigator();
  };
  const onDirty = (e: MouseEvent) => {
    if (e.shiftKey) {
      useSourceControlStore.getState().openPanel(workspaceId);
      setChangesOpen(false);
      return;
    }
    setChangesOpen((o) => !o);
  };
  const onChat = () => openDockChats(workspaceId);

  const isBreadcrumb = variant === 'breadcrumb';

  const chips = (
    <>
      <ContextChip
        label={workspaceLabel}
        ariaLabel={`Workspace ${workspaceLabel}`}
        title={`Open ${workspaceLabel} in navigator`}
        onClick={onWorkspace}
        icon={
          <FolderOpen
            className={cn(SHELL_ROW_ICON_CLASS, 'shrink-0 opacity-70')}
            strokeWidth={SHELL_ROW_ICON_STROKE}
            aria-hidden
          />
        }
        className={isBreadcrumb ? 'max-w-[10rem] text-text-faint hover:text-text-secondary' : undefined}
      />

      <ContextSeparator />

      {gitContext.isRepo || githubBranch ? (
        <>
          <button
            ref={branchTriggerRef}
            type="button"
            aria-label={`Branch ${branchLabel}`}
            className={cn(
              'vx-workspace-context-chip inline-flex max-w-[12rem] items-center gap-1 truncate rounded-inner px-1.5 py-0.5 font-mono transition-colors hover:bg-chrome-hover-soft hover:text-text-secondary',
              isBreadcrumb ? 'text-meta text-text-faint' : 'text-meta text-text-faint'
            )}
            title={
              hasGitHubBinding
                ? `Switch branch (${branchLabel})`
                : gitContext.isRepo
                  ? `Branch ${branchLabel} — open source control`
                  : `Open ${workspaceLabel} in navigator`
            }
            onClick={onBranch}
          >
            <GitBranch
              className={cn(SHELL_ROW_ICON_CLASS, 'shrink-0 opacity-70')}
              strokeWidth={SHELL_ROW_ICON_STROKE}
              aria-hidden
            />
            <span className="truncate">{branchLabel}</span>
          </button>
          {hasGitHubBinding ? (
            <Popover
              open={branchOpen}
              onClose={() => setBranchOpen(false)}
              triggerRef={branchTriggerRef}
              align="center"
              preferSide="bottom"
            >
              <BranchPickerPanel workspaceId={workspaceId} onClose={() => setBranchOpen(false)} />
            </Popover>
          ) : null}
        </>
      ) : (
        <button
          type="button"
          className="vx-workspace-context-chip truncate px-1.5 py-0.5 font-mono text-text-faint hover:bg-chrome-hover-soft hover:text-text-secondary"
          title="Open workspace in navigator"
          aria-label="Not a git repository — open navigator"
          onClick={onWorkspace}
        >
          not a git repository
        </button>
      )}

      {dirtyLabel ? (
        <>
          <ContextSeparator />
          <button
            ref={changesTriggerRef}
            type="button"
            aria-label={`${dirtyCount} uncommitted changes`}
            aria-expanded={changesOpen}
            aria-haspopup="dialog"
            className={cn(
              'vx-workspace-context-chip inline-flex max-w-[14rem] items-center gap-1 truncate rounded-inner px-1.5 py-0.5 font-mono text-meta transition-colors hover:bg-chrome-hover-soft hover:text-text-secondary',
              isBreadcrumb ? 'text-warning/90 hover:text-warning' : 'text-warning/80 hover:text-warning'
            )}
            title={`${dirtyCount} uncommitted — click to preview, Shift+click for source control`}
            onClick={onDirty}
          >
            <span className="truncate">{dirtyLabel}</span>
          </button>
          <Popover
            open={changesOpen}
            onClose={() => setChangesOpen(false)}
            triggerRef={changesTriggerRef}
            align="center"
            preferSide="bottom"
            widthMode="panel"
            fitMaxWidth={560}
            zIndex={CHROME_LAYER_TITLEBAR_POPOVER}
            collisionPadding={{ top: readTitlebarInsetPx(), left: 16, right: 16, bottom: 16 }}
          >
            <SourceControlChangesPanel
              workspaceId={workspaceId}
              onClose={() => setChangesOpen(false)}
            />
          </Popover>
        </>
      ) : null}

      {isBreadcrumb && chatTitle && chatTitle !== 'Untitled' ? (
        <>
          <ContextSeparator />
          <ContextChip
            label={chatTitle}
            ariaLabel={`Chat ${chatTitle}`}
            title={`Open chat: ${chatTitle}`}
            onClick={onChat}
            className="max-w-[12rem] text-text-primary hover:text-text-primary"
          />
        </>
      ) : null}
    </>
  );

  return (
    <div
      className={cn(
        'vx-workspace-context-bar flex min-w-0 items-center justify-center',
        isBreadcrumb ? 'text-row' : 'text-meta',
        !isBreadcrumb && 'vx-workspace-context-bar--landing',
        className
      )}
      role="navigation"
      aria-label="Workspace context"
    >
      {chips}
    </div>
  );
}
