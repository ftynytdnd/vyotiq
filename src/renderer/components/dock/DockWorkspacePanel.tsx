/**
 * Active-workspace panel — files and chats as segmented sub-views
 * scoped to the selected workspace.
 */

import { useEffect, useMemo } from 'react';
import { Files, MessageSquare } from 'lucide-react';
import { Tabs } from '../ui/Tabs.js';
import { DockChatStrip } from './DockChatStrip.js';
import { DockFileTree } from './DockFileTree.js';
import { DockOpenEditorsSection } from './DockOpenEditorsSection.js';
import {
  DOCK_WORKSPACE_PANEL_CLASS,
  DOCK_WORKSPACE_PANEL_SHELL_CLASS,
  type DockPanelTab
} from './dockShared.js';
import { useConversationsStore } from '../../store/useConversationsStore.js';
import { useUiStore } from '../../store/useUiStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { cn } from '../../lib/cn.js';
import { SHELL_ACTION_ICON_STROKE, SHELL_ROW_ICON_CLASS } from '../../lib/shellIcons.js';

const FILES_PANEL_ID = 'vx-dock-files-panel';
const CHATS_PANEL_ID = 'vx-dock-chats-panel';

export interface DockWorkspacePanelProps {
  workspaceId: string | null;
}

export function DockWorkspacePanel({ workspaceId }: DockWorkspacePanelProps) {
  const view = useUiStore((s) => s.dockPanelTab);
  const setView = useUiStore((s) => s.setDockPanelTab);

  const workspace = useWorkspaceStore((s) =>
    workspaceId ? s.list.find((entry) => entry.id === workspaceId) : undefined
  );

  const chatCount = useConversationsStore((s) => {
    if (!workspaceId) return 0;
    return s.list.filter((entry) => entry.workspaceId === workspaceId && !entry.archived).length;
  });

  useEffect(() => {
    if (!workspaceId) setView('files');
  }, [workspaceId, setView]);

  const tabItems = useMemo(
    () => [
      {
        id: 'files' as const,
        label: 'Files',
        icon: <Files className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />,
        panelId: FILES_PANEL_ID,
        tabId: 'vx-dock-tab-files'
      },
      {
        id: 'chats' as const,
        label: chatCount > 0 ? `Chats (${chatCount})` : 'Chats',
        icon: <MessageSquare className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />,
        panelId: CHATS_PANEL_ID,
        tabId: 'vx-dock-tab-chats',
        disabled: !workspaceId
      }
    ],
    [chatCount, workspaceId]
  );

  const onTabChange = (next: DockPanelTab) => {
    setView(next);
    if (next === 'chats' && workspaceId) {
      useUiStore.getState().clearWorkspaceCollapsed(workspaceId);
    }
  };

  if (!workspaceId) {
    return (
      <div className={cn(DOCK_WORKSPACE_PANEL_SHELL_CLASS, 'flex min-h-0 flex-1 flex-col')}>
        <div className={cn(DOCK_WORKSPACE_PANEL_CLASS, 'flex flex-1 items-center justify-center px-3 py-6')}>
          <p className="text-center text-row text-text-faint">
            Select or open a workspace to browse files and chats.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn(DOCK_WORKSPACE_PANEL_SHELL_CLASS, 'flex min-h-0 flex-1 flex-col overflow-hidden')}>
      <div className={cn(DOCK_WORKSPACE_PANEL_CLASS, 'flex min-h-0 flex-1 flex-col overflow-hidden')}>
        <header className="shrink-0 border-t border-border-subtle/25 px-2 pb-1.5 pt-2">
          {workspace?.path ? (
            <p className="truncate px-0.5 font-mono text-meta text-text-faint" title={workspace.path}>
              {workspace.path}
            </p>
          ) : null}
          <div className={workspace?.path ? 'mt-1.5' : undefined}>
            <Tabs
              variant="segmented"
              size="sm"
              ariaLabel="Workspace contents"
              items={tabItems}
              value={view}
              onChange={onTabChange}
            />
          </div>
        </header>

        <div
          id={view === 'files' ? FILES_PANEL_ID : CHATS_PANEL_ID}
          role="tabpanel"
          aria-labelledby={view === 'files' ? 'vx-dock-tab-files' : 'vx-dock-tab-chats'}
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          {view === 'files' ? (
            <>
              <DockOpenEditorsSection workspaceId={workspaceId} />
              <DockFileTree workspaceId={workspaceId} />
            </>
          ) : (
            <DockChatStrip workspaceId={workspaceId} />
          )}
        </div>
      </div>
    </div>
  );
}
