/**
 * Title bar breadcrumb — workspace › active chat in the drag region.
 */

import { useMemo } from 'react';
import { buildDisplayChatTitles } from '../dock/displayChatTitles.js';
import { useConversationsStore } from '../../store/useConversationsStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { TITLEBAR_BREADCRUMB_ZONE_CLASS } from './titlebarShared.js';
import { cn } from '../../lib/cn.js';

export function TitleBarContext() {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeId);
  const workspaces = useWorkspaceStore((s) => s.list);
  const list = useConversationsStore((s) => s.list);
  const activeIdByWorkspace = useConversationsStore((s) => s.activeIdByWorkspace);

  const workspaceLabel = useMemo(() => {
    if (!activeWorkspaceId) return null;
    return workspaces.find((w) => w.id === activeWorkspaceId)?.label ?? null;
  }, [activeWorkspaceId, workspaces]);

  const workspaceChats = useMemo(() => {
    if (!activeWorkspaceId) return [];
    return list.filter((c) => c.workspaceId === activeWorkspaceId && !c.archived);
  }, [list, activeWorkspaceId]);

  const displayTitles = useMemo(() => buildDisplayChatTitles(workspaceChats), [workspaceChats]);

  const chatTitle = useMemo(() => {
    if (!activeWorkspaceId) return null;
    const activeChatId = activeIdByWorkspace[activeWorkspaceId] ?? null;
    if (!activeChatId) return 'New chat';
    return displayTitles.get(activeChatId) ?? 'New chat';
  }, [activeWorkspaceId, activeIdByWorkspace, displayTitles]);

  if (!workspaceLabel) {
    return (
      <div className={TITLEBAR_BREADCRUMB_ZONE_CLASS}>
        <p className="vx-titlebar-breadcrumb pointer-events-none text-text-faint">No workspace</p>
      </div>
    );
  }

  return (
    <div className={TITLEBAR_BREADCRUMB_ZONE_CLASS}>
      <p className={cn('vx-titlebar-breadcrumb pointer-events-none')}>
        <span className="shrink-0 text-text-faint">{workspaceLabel}</span>
        <span className="shrink-0 text-text-faint" aria-hidden>
          {' › '}
        </span>
        <span className="min-w-0 truncate text-text-muted">{chatTitle}</span>
      </p>
    </div>
  );
}
