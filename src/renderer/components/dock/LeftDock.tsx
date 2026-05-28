/**
 * LeftDock — workspace tabs + chat strip. Flat layout; highlights only on
 * active tabs, hover, open search, and running state — not boxed sections.
 */

import { FolderOpen } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DockChatStrip } from './DockChatStrip.js';
import { DockSearchPopover } from './DockSearchPopover.js';
import { DockToolbar } from './DockToolbar.js';
import { DockWorkspaceTabs } from './DockWorkspaceTabs.js';
import { DockSectionHeader } from './DockSectionHeader.js';
import { DockAgentPeek } from './DockAgentPeek.js';
import {
  clampDockWidth,
  dockWorkspaceIndicatorLabel,
  DOCK_DIVIDER_H_CLASS,
  DOCK_FOOTER_CLASS,
  DOCK_INSET_CLASS,
  DOCK_RESIZE_HANDLE_CLASS,
  DOCK_TAB_ICON_CLASS,
  DOCK_TAB_ICON_STROKE,
  DOCK_WIDTH_COLLAPSED_PX,
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
  const moveHandlerRef = useRef<((ev: MouseEvent) => void) | null>(null);
  const upHandlerRef = useRef<(() => void) | null>(null);

  const activeWorkspaceLabel = useMemo(() => {
    if (!activeWorkspaceId) return null;
    return workspaces.find((w) => w.id === activeWorkspaceId)?.label ?? null;
  }, [activeWorkspaceId, workspaces]);

  const collapsedTooltip = useMemo(() => {
    if (!activeWorkspaceId) return 'Expand navigation (Ctrl+B): open a workspace';
    return `Expand navigation (Ctrl+B): ${activeWorkspaceLabel ?? 'workspace'}`;
  }, [activeWorkspaceId, activeWorkspaceLabel]);

  const indicatorShort = useMemo(
    () => dockWorkspaceIndicatorLabel(activeWorkspaceLabel),
    [activeWorkspaceLabel]
  );

  const handleToggleSearch = () => {
    if (!dockExpanded) setDockExpanded(true);
    toggleSearch();
  };

  useEffect(() => {
    if (!dockExpanded && searchOpen) {
      useDockSearchStore.getState().setOpen(false);
    }
  }, [dockExpanded, searchOpen]);

  useEffect(() => {
    return () => {
      if (moveHandlerRef.current) {
        window.removeEventListener('mousemove', moveHandlerRef.current);
        moveHandlerRef.current = null;
      }
      if (upHandlerRef.current) {
        window.removeEventListener('mouseup', upHandlerRef.current);
        upHandlerRef.current = null;
      }
      dragWidthRef.current = null;
    };
  }, []);

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
        moveHandlerRef.current = null;
        upHandlerRef.current = null;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        if (dragWidthRef.current !== null) {
          setDockWidth(dragWidthRef.current);
        }
        dragWidthRef.current = null;
        setLiveWidth(null);
      };

      moveHandlerRef.current = onMove;
      upHandlerRef.current = onUp;
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [dockWidth, setDockWidth]
  );

  const expandedWidthPx = liveWidth ?? dockWidth;

  const toolbarProps = {
    searchOpen,
    onNewChat: () => void newConversation(),
    onToggleSearch: handleToggleSearch,
    onCollapse: () => toggleDock()
  };

  return (
    <nav
      aria-label="Workspace and session navigation"
      aria-expanded={dockExpanded}
      className={cn(
        'app-no-drag relative h-full min-h-0 shrink-0 overflow-hidden bg-surface-sidebar',
        liveWidth !== null ? '' : 'transition-[width] duration-200 ease-out'
      )}
      style={{
        width: dockExpanded ? `${expandedWidthPx}px` : `${DOCK_WIDTH_COLLAPSED_PX}px`
      }}
    >
      {dockExpanded ? (
        <>
          <div className={cn(DOCK_INSET_CLASS, 'h-full gap-0 py-1.5')}>
            <div className={workspacePanelClassName(workspaces.length)}>
              <DockSectionHeader label="Workspaces" />
              <DockWorkspaceTabs />
            </div>
            <div className={DOCK_DIVIDER_H_CLASS} aria-hidden />
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <DockSectionHeader label="Chats" />
              <DockChatStrip workspaceId={activeWorkspaceId} />
            </div>
            <div className={DOCK_FOOTER_CLASS}>
              <DockSearchPopover />
              <DockToolbar layout="horizontal" {...toolbarProps} collapseIcon="left" />
            </div>
          </div>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize navigation dock"
            onMouseDown={onResizeStart}
            className={DOCK_RESIZE_HANDLE_CLASS}
          />
        </>
      ) : (
        <div className="flex h-full min-h-0 flex-col items-center gap-1 px-1 py-2">
          <button
            type="button"
            onClick={() => setDockExpanded(true)}
            aria-expanded={false}
            aria-label={`Expand navigation: ${collapsedTooltip}`}
            title={collapsedTooltip}
            className={cn(
              'vx-btn vx-btn-quiet h-6 w-6 shrink-0 px-0 font-mono text-meta',
              workspaceHasActiveRun && 'vyotiq-shimmer-pill'
            )}
          >
            {activeWorkspaceId ? (
              <span className="truncate">{indicatorShort}</span>
            ) : (
              <FolderOpen className={DOCK_TAB_ICON_CLASS} strokeWidth={DOCK_TAB_ICON_STROKE} aria-hidden />
            )}
          </button>
          <DockToolbar layout="vertical" {...toolbarProps} collapseIcon="right" />
        </div>
      )}
      <DockAgentPeek />
    </nav>
  );
}

