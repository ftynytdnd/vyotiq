/**
 * BottomDock — primary navigation surface (workspace tabs + chat strip).
 *
 * Embedded at the bottom of the unified {@link ChatFooter} card.
 *
 * Collapsed (default):
 *   Slim strip — chat count + expand affordance + toolbar
 *
 * Expanded:
 *   Single row — workspace tabs | chat strip | toolbar
 *   Search expands as a row above the dock strip when open.
 */

import { ChevronDown, ChevronUp, Search, SquarePen } from 'lucide-react';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { DockChatStrip } from './DockChatStrip.js';
import { DockSearchPopover } from './DockSearchPopover.js';
import { DockWorkspaceTabs } from './DockWorkspaceTabs.js';
import { useDockShortcuts } from './useDockShortcuts.js';
import { useUiStore } from '../../store/useUiStore.js';
import { useConversationsStore } from '../../store/useConversationsStore.js';
import { useDockSearchStore } from '../../store/useDockSearchStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { cn } from '../../lib/cn.js';

interface BottomDockProps {
  /** When true, renders inside the shared footer card (no outer chrome). */
  embedded?: boolean;
}

export function BottomDock({ embedded = false }: BottomDockProps) {
  useDockShortcuts();

  const dockExpanded = useUiStore((s) => s.dockExpanded);
  const toggleDock = useUiStore((s) => s.toggleDock);
  const setDockExpanded = useUiStore((s) => s.setDockExpanded);

  const newConversation = useConversationsStore((s) => s.newConversation);
  const conversationList = useConversationsStore((s) => s.list);
  const toggleSearch = useDockSearchStore((s) => s.toggle);
  const searchOpen = useDockSearchStore((s) => s.open);

  const activeWorkspaceId = useWorkspaceStore((s) => s.activeId);

  const chatCount = useMemo(() => {
    if (!activeWorkspaceId) return 0;
    return conversationList.filter((c) => c.workspaceId === activeWorkspaceId).length;
  }, [conversationList, activeWorkspaceId]);

  const collapsedLabel = useMemo(() => {
    if (!activeWorkspaceId) return 'Open a workspace';
    if (chatCount === 0) return 'No chats yet';
    return `${chatCount} chat${chatCount === 1 ? '' : 's'}`;
  }, [activeWorkspaceId, chatCount]);

  return (
    <footer
      className={cn(
        'relative shrink-0 transition-[height] duration-200 ease-out',
        embedded
          ? 'mt-0 border-0 bg-transparent pt-0'
          : 'border-t border-border-subtle/40 bg-surface-raised'
      )}
    >
      <DockSearchPopover />
      {dockExpanded ? (
        <div className="flex h-8 items-center gap-1 px-1.5">
          <div className="flex min-w-0 max-w-[44%] shrink-0 items-center">
            <DockWorkspaceTabs />
          </div>
          <div className="h-3.5 w-px shrink-0 bg-border-subtle/30" aria-hidden />
          <div className="min-w-0 flex-1">
            <DockChatStrip workspaceId={activeWorkspaceId} />
          </div>
          <DockToolbar
            searchOpen={searchOpen}
            onNewChat={() => void newConversation()}
            onToggleSearch={() => {
              if (!dockExpanded) setDockExpanded(true);
              toggleSearch();
            }}
            onCollapse={() => toggleDock()}
            collapseIcon="down"
          />
        </div>
      ) : (
        <div className="flex h-7 items-center gap-2 px-3">
          <button
            type="button"
            onClick={() => setDockExpanded(true)}
            aria-expanded={false}
            aria-label={`Expand navigation: ${collapsedLabel}`}
            className={cn(
              'app-no-drag flex min-w-0 flex-1 items-center gap-1.5 truncate text-row',
              'text-text-muted transition-colors duration-150 hover:text-text-primary'
            )}
            title="Expand navigation (Ctrl+B)"
          >
            <span className="truncate">{collapsedLabel}</span>
          </button>
          <DockToolbar
            searchOpen={searchOpen}
            onNewChat={() => void newConversation()}
            onToggleSearch={() => {
              if (!dockExpanded) setDockExpanded(true);
              toggleSearch();
            }}
            onCollapse={() => toggleDock()}
            collapseIcon="up"
          />
        </div>
      )}
    </footer>
  );
}

interface DockToolbarProps {
  searchOpen: boolean;
  onNewChat: () => void;
  onToggleSearch: () => void;
  onCollapse: () => void;
  collapseIcon: 'up' | 'down';
}

function DockToolbar({
  searchOpen,
  onNewChat,
  onToggleSearch,
  onCollapse,
  collapseIcon
}: DockToolbarProps) {
  const CollapseIcon = collapseIcon === 'down' ? ChevronDown : ChevronUp;

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <DockIconButton label="New chat" title="New chat (Ctrl+N)" onClick={onNewChat}>
        <SquarePen className="h-3.5 w-3.5" strokeWidth={2} />
      </DockIconButton>
      <DockIconButton
        label="Search chats"
        title="Search chats (Ctrl+K)"
        active={searchOpen}
        onClick={onToggleSearch}
      >
        <Search className="h-3.5 w-3.5" strokeWidth={2} />
      </DockIconButton>
      <DockIconButton
        label={collapseIcon === 'down' ? 'Collapse dock' : 'Expand dock'}
        title="Toggle dock (Ctrl+B)"
        onClick={onCollapse}
      >
        <CollapseIcon className="h-3.5 w-3.5" strokeWidth={2.25} />
      </DockIconButton>
    </div>
  );
}

function DockIconButton({
  label,
  title,
  active,
  onClick,
  children
}: {
  label: string;
  title: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title}
      onClick={onClick}
      className={cn(
        'app-no-drag inline-flex h-6 w-6 items-center justify-center rounded-inner',
        'text-text-faint transition-colors duration-150',
        'hover:bg-surface-hover hover:text-text-primary',
        active && 'bg-surface-hover text-text-primary'
      )}
    >
      {children}
    </button>
  );
}
