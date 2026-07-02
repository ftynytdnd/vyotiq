/**
 * Unified dock navigator — flat workspace tree + bottom files panel.
 */

import { useEffect, useRef, useState } from 'react';
import { FolderInput, Plus } from 'lucide-react';
import { DockNavigatorHeader } from './DockNavigatorHeader.js';
import { DockWorkspaceFolder } from './DockWorkspaceFolder.js';
import { DockFilesPanel } from './DockFilesPanel.js';
import {
  WorkspacePendingBanner,
  type WorkspacePendingAction
} from './WorkspacePendingBanner.js';
import { LoadingHint } from '../ui/LoadingHint.js';
import { Button } from '../ui/Button.js';
import { cn } from '../../lib/cn.js';
import {
  SHELL_ACTION_ICON_STROKE,
  SHELL_ROW_ICON_CLASS
} from '../../lib/shellIcons.js';
import {
  DOCK_EMPTY_STATE_CLASS,
  DOCK_WORKSPACE_PANEL_SHELL_CLASS,
  dismissDockSearchAfterSelection
} from './dockShared.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { useUiStore } from '../../store/useUiStore.js';
import { openWorkspaceLauncher } from '../../store/useWorkspaceLauncherStore.js';

export interface DockNavigatorProps {
  onSetWorkspacePath: () => void;
}

export function DockNavigator({ onSetWorkspacePath }: DockNavigatorProps) {
  const workspaces = useWorkspaceStore((s) => s.list);
  const activeId = useWorkspaceStore((s) => s.activeId);
  const setActive = useWorkspaceStore((s) => s.setActive);
  const removeWorkspace = useWorkspaceStore((s) => s.remove);
  const retryReachability = useWorkspaceStore((s) => s.retryReachability);
  const loading = useWorkspaceStore((s) => s.loading);

  const filesExpanded = useUiStore(
    (s) => (activeId ? s.filesExpandedWorkspaces.has(activeId) : false)
  );
  const toggleWorkspaceFilesExpanded = useUiStore((s) => s.toggleWorkspaceFilesExpanded);
  const collapsedWorkspaces = useUiStore((s) => s.collapsedWorkspaces);
  const toggleWorkspaceCollapsed = useUiStore((s) => s.toggleWorkspaceCollapsed);
  const clearWorkspaceCollapsed = useUiStore((s) => s.clearWorkspaceCollapsed);

  const [pendingAction, setPendingAction] = useState<WorkspacePendingAction | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const filesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pendingAction) return;
    if (!workspaces.some((entry) => entry.id === pendingAction.workspace.id)) {
      setPendingAction(null);
    }
  }, [workspaces, pendingAction]);

  useEffect(() => {
    if (!filesExpanded || !activeId) return;
    filesRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [filesExpanded, activeId]);

  const onActivateWorkspace = (workspaceId: string) => {
    void setActive(workspaceId);
    clearWorkspaceCollapsed(workspaceId);
    dismissDockSearchAfterSelection();
  };

  const toggleFilesPanel = () => {
    if (!activeId) return;
    toggleWorkspaceFilesExpanded(activeId);
  };

  if (loading && workspaces.length === 0) {
    return (
      <div className={cn(DOCK_WORKSPACE_PANEL_SHELL_CLASS, 'flex min-h-0 flex-1 flex-col')}>
        <DockNavigatorHeader />
        <div className={cn(DOCK_EMPTY_STATE_CLASS, 'flex-row items-center px-3')}>
          <LoadingHint message="Loading workspaces…" className="py-2" />
        </div>
      </div>
    );
  }

  if (workspaces.length === 0) {
    return (
      <div className={cn(DOCK_WORKSPACE_PANEL_SHELL_CLASS, 'flex min-h-0 flex-1 flex-col')}>
        <DockNavigatorHeader />
        <div className="vx-dock-workspace-empty flex flex-1 flex-col items-start gap-3 px-3 py-4">
          <p className="text-hero font-medium text-text-primary">Open a workspace</p>
          <p className="text-row text-text-muted">
            Agent V needs a folder on your machine to sandbox tools and memory.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="accentFill" size="sm" onClick={() => openWorkspaceLauncher('local', 'inline')}>
              <FolderInput className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} aria-hidden />
              Open folder…
            </Button>
            <Button variant="secondary" size="sm" onClick={() => openWorkspaceLauncher('github', 'inline')}>
              <Plus className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} aria-hidden />
              From GitHub
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn(DOCK_WORKSPACE_PANEL_SHELL_CLASS, 'flex min-h-0 flex-1 flex-col overflow-hidden')}>
      <DockNavigatorHeader />

      {pendingAction ? (
        <div className="vx-dock-workspace-pending shrink-0 px-2 pb-1">
          <WorkspacePendingBanner
            pending={pendingAction}
            onDismiss={() => setPendingAction(null)}
            onRemoveContinue={(workspaceId) => {
              const workspace = workspaces.find((entry) => entry.id === workspaceId);
              if (!workspace) {
                setPendingAction(null);
                return;
              }
              setPendingAction({ kind: 'remove-choice', workspace });
            }}
            onRemoveKeepChats={(workspaceId) => {
              setPendingAction(null);
              void removeWorkspace(workspaceId, { deleteConversations: false });
            }}
            onRemoveDeleteChats={(workspaceId) => {
              setPendingAction(null);
              void removeWorkspace(workspaceId, { deleteConversations: true });
            }}
            onRetry={(workspaceId) => {
              setPendingAction(null);
              void retryReachability(workspaceId);
            }}
          />
        </div>
      ) : null}

      <div
        ref={scrollRef}
        className="vx-dock-nav-scroll scrollbar-stealth flex min-h-0 flex-1 flex-col overflow-y-auto"
      >
        <div
          ref={treeRef}
          className="vx-dock-nav-tree flex shrink-0 flex-col gap-0.5 pt-0.5"
          role="tree"
          aria-label="Workspaces"
        >
          {workspaces.map((workspace) => {
            const active = workspace.id === activeId;
            const expanded = active && !collapsedWorkspaces.has(workspace.id);
            return (
              <DockWorkspaceFolder
                key={workspace.id}
                workspace={workspace}
                active={active}
                expanded={expanded}
                pending={pendingAction?.workspace.id === workspace.id}
                onSetWorkspacePath={onSetWorkspacePath}
                onRequestPending={setPendingAction}
                onToggleExpanded={() => toggleWorkspaceCollapsed(workspace.id)}
                onActivate={() => onActivateWorkspace(workspace.id)}
              />
            );
          })}
        </div>

        {activeId ? (
          <div
            ref={filesRef}
            className={cn(
              'vx-dock-nav-files',
              filesExpanded ? 'flex min-h-0 flex-1 flex-col' : 'shrink-0'
            )}
          >
            <DockFilesPanel
              workspaceId={activeId}
              workspaceLabel={workspaces.find((entry) => entry.id === activeId)?.label}
              expanded={filesExpanded}
              onToggle={toggleFilesPanel}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
