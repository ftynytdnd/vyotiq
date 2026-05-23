/**
 * LeftDock — primary navigation surface (workspace tabs + chat strip).
 *
 * Full-height left column below the title bar.
 *
 * Collapsed (default):
 *   Narrow rail — vertical label + stacked toolbar icons
 *
 * Expanded:
 *   Vertical stack — workspace tabs | chat strip | search (when open) | footer toolbar
 */

import { ChevronLeft, ChevronRight, Search, SquarePen } from 'lucide-react';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DockChatStrip } from './DockChatStrip.js';
import { DockSearchPopover } from './DockSearchPopover.js';
import { DockWorkspaceTabs } from './DockWorkspaceTabs.js';
import { DockSectionHeader } from './DockSectionHeader.js';
import {
  clampDockWidth,
  DOCK_DIVIDER_H_CLASS,
  DOCK_EDGE_CLASS,
  DOCK_FOOTER_CLASS,
  DOCK_RESIZE_HANDLE_CLASS,
  DOCK_WIDTH_COLLAPSED_PX,
  DOCK_WIDTH_DEFAULT,
  workspacePanelClassName
} from './dockShared.js';
import { useDockShortcuts } from './useDockShortcuts.js';
import { useUiStore } from '../../store/useUiStore.js';
import { useConversationsStore } from '../../store/useConversationsStore.js';
import { useDockSearchStore } from '../../store/useDockSearchStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { useWorkspaceHasActiveRun } from '../../hooks/chat/useWorkspaceHasActiveRun.js';
import { cn } from '../../lib/cn.js';

export function LeftDock() {
  useDockShortcuts();

  const dockExpanded = useUiStore((s) => s.dockExpanded);
  const dockWidth = useUiStore((s) => s.dockWidth);
  const toggleDock = useUiStore((s) => s.toggleDock);
  const setDockExpanded = useUiStore((s) => s.setDockExpanded);
  const setDockWidth = useUiStore((s) => s.setDockWidth);

  const newConversation = useConversationsStore((s) => s.newConversation);
  const toggleSearch = useDockSearchStore((s) => s.toggle);
  const searchOpen = useDockSearchStore((s) => s.open);

  const activeWorkspaceId = useWorkspaceStore((s) => s.activeId);
  const workspaces = useWorkspaceStore((s) => s.list);
  const workspaceHasActiveRun = useWorkspaceHasActiveRun(activeWorkspaceId);

  const [liveWidth, setLiveWidth] = useState<number | null>(null);
  const dragWidthRef = useRef<number | null>(null);

  const activeWorkspaceLabel = useMemo(() => {
    if (!activeWorkspaceId) return null;
    return workspaces.find((w) => w.id === activeWorkspaceId)?.label ?? null;
  }, [activeWorkspaceId, workspaces]);

  const collapsedTooltip = useMemo(() => {
    if (!activeWorkspaceId) return 'Expand navigation (Ctrl+B): open a workspace';
    return `Expand navigation (Ctrl+B): ${activeWorkspaceLabel ?? 'workspace'}`;
  }, [activeWorkspaceId, activeWorkspaceLabel]);

  const collapsedLabel = useMemo(() => {
    if (activeWorkspaceLabel) return activeWorkspaceLabel;
    return 'Open workspace';
  }, [activeWorkspaceLabel]);

  const handleToggleSearch = () => {
    if (!dockExpanded) setDockExpanded(true);
    toggleSearch();
  };

  useEffect(() => {
    if (!dockExpanded && searchOpen) {
      useDockSearchStore.getState().setOpen(false);
    }
  }, [dockExpanded, searchOpen]);

  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = dockWidth;
      dragWidthRef.current = startWidth;
      setLiveWidth(startWidth);

      const onMove = (ev: MouseEvent) => {
        const next = clampDockWidth(startWidth + (ev.clientX - startX));
        dragWidthRef.current = next;
        setLiveWidth(next);
      };

      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        if (dragWidthRef.current !== null) {
          setDockWidth(dragWidthRef.current);
        }
        dragWidthRef.current = null;
        setLiveWidth(null);
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [dockWidth, setDockWidth]
  );

  const expandedWidthPx = liveWidth ?? dockWidth;

  return (
    <nav
      aria-label="Workspace and session navigation"
      aria-expanded={dockExpanded}
      className={cn(
        'app-no-drag relative h-full min-h-0 shrink-0 overflow-hidden',
        DOCK_EDGE_CLASS,
        'bg-surface-raised',
        workspaceHasActiveRun && !dockExpanded && 'before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-accent/80',
        liveWidth !== null ? '' : 'transition-[width] duration-200 ease-out'
      )}
      style={{
        width: dockExpanded ? `${expandedWidthPx}px` : `${DOCK_WIDTH_COLLAPSED_PX}px`
      }}
    >
      {dockExpanded ? (
        <div className="flex h-full min-h-0 flex-col">
          <div className={workspacePanelClassName(workspaces.length)}>
            <DockSectionHeader label="Workspaces" className="pt-2" />
            <DockWorkspaceTabs />
          </div>
          <div className={DOCK_DIVIDER_H_CLASS} aria-hidden />
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <DockSectionHeader label="Chats" className="pt-1.5" />
            <DockChatStrip workspaceId={activeWorkspaceId} />
          </div>
          <div className={DOCK_FOOTER_CLASS}>
            <DockSearchPopover />
            <div className="px-1.5 py-1.5">
              <DockToolbar
                layout="horizontal"
                searchOpen={searchOpen}
                onNewChat={() => void newConversation()}
                onToggleSearch={handleToggleSearch}
                onCollapse={() => toggleDock()}
                collapseIcon="left"
              />
            </div>
          </div>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize navigation dock"
            onMouseDown={onResizeStart}
            className={DOCK_RESIZE_HANDLE_CLASS}
          />
        </div>
      ) : (
        <div className="flex h-full min-h-0 flex-col items-center py-1.5">
          <button
            type="button"
            onClick={() => setDockExpanded(true)}
            aria-expanded={false}
            aria-label={`Expand navigation: ${collapsedTooltip}`}
            title={collapsedTooltip}
            className={cn(
              'app-no-drag flex min-h-0 flex-1 flex-col items-center justify-center gap-1 px-0.5',
              'text-row text-text-muted transition-colors duration-150 hover:text-text-primary',
              workspaceHasActiveRun && 'vyotiq-shimmer-pill'
            )}
          >
            <span
              className="max-h-[70%] truncate text-row"
              style={{ writingMode: 'vertical-rl' }}
            >
              {collapsedLabel}
            </span>
          </button>
          <DockToolbar
            layout="vertical"
            searchOpen={searchOpen}
            onNewChat={() => void newConversation()}
            onToggleSearch={handleToggleSearch}
            onCollapse={() => toggleDock()}
            collapseIcon="right"
            className="pb-0.5"
          />
        </div>
      )}
    </nav>
  );
}

interface DockToolbarProps {
  layout: 'horizontal' | 'vertical';
  searchOpen: boolean;
  onNewChat: () => void;
  onToggleSearch: () => void;
  onCollapse: () => void;
  collapseIcon: 'left' | 'right';
  className?: string;
}

function DockToolbar({
  layout,
  searchOpen,
  onNewChat,
  onToggleSearch,
  onCollapse,
  collapseIcon,
  className
}: DockToolbarProps) {
  const CollapseIcon = collapseIcon === 'left' ? ChevronLeft : ChevronRight;

  return (
    <div
      className={cn(
        'flex shrink-0',
        layout === 'horizontal'
          ? 'items-center justify-between gap-1'
          : 'flex-col items-center gap-1',
        className
      )}
    >
      {layout === 'horizontal' ? (
        <>
          <div className="flex min-w-0 flex-1 items-center gap-0.5">
            <button
              type="button"
              aria-label="New chat"
              title="New chat (Ctrl+N)"
              onClick={onNewChat}
              className={cn(
                'app-no-drag inline-flex h-7 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-inner px-2',
                'text-row text-text-muted transition-colors duration-150',
                'hover:bg-surface-hover hover:text-text-primary'
              )}
            >
              <SquarePen className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              <span className="truncate">New chat</span>
            </button>
            <DockIconButton
              label="Search chats"
              title="Search chats (Ctrl+K)"
              active={searchOpen}
              onClick={onToggleSearch}
            >
              <Search className="h-3.5 w-3.5" strokeWidth={2} />
            </DockIconButton>
          </div>
          <DockIconButton
            label="Collapse dock"
            title="Toggle dock (Ctrl+B)"
            onClick={onCollapse}
          >
            <CollapseIcon className="h-3.5 w-3.5" strokeWidth={2.25} />
          </DockIconButton>
        </>
      ) : (
        <>
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
            label="Expand dock"
            title="Toggle dock (Ctrl+B)"
            onClick={onCollapse}
          >
            <CollapseIcon className="h-3.5 w-3.5" strokeWidth={2.25} />
          </DockIconButton>
        </>
      )}
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

export { DOCK_WIDTH_DEFAULT as LEFT_DOCK_WIDTH_DEFAULT };
