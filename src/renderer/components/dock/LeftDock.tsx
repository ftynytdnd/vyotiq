/**
 * LeftDock — floating rail + flyout panel for workspace tabs and chat strip.
 * Collapsed: centered icon pill overlay. Expanded: flyout replaces rail with full lists.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { DockChatStrip } from './DockChatStrip.js';
import { DockExpandBackdrop } from './DockExpandBackdrop.js';
import { DockSearchPopover } from './DockSearchPopover.js';
import { DockToolbar } from './DockToolbar.js';
import { DockWorkspaceTabs } from './DockWorkspaceTabs.js';
import { DockSectionHeader } from './DockSectionHeader.js';
import {
  clampDockWidth,
  dismissDockFlyout,
  DOCK_DIVIDER_H_CLASS,
  DOCK_FOOTER_CLASS,
  DOCK_INSET_CLASS,
  DOCK_RAIL_PILL_CLASS,
  DOCK_RESIZE_HANDLE_CLASS,
  dockFlyoutShellClassName,
  workspacePanelClassName
} from './dockShared.js';
import { useDockFlyoutFocus } from './useDockFlyoutFocus.js';
import { useDockShortcuts } from './useDockShortcuts.js';
import { useUiStore } from '../../store/useUiStore.js';
import { useConversationsStore } from '../../store/useConversationsStore.js';
import { useDockSearchStore } from '../../store/useDockSearchStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { cn } from '../../lib/cn.js';

export interface LeftDockProps {
  onOpenSettings: () => void;
}

export function LeftDock({ onOpenSettings }: LeftDockProps) {
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

  const [liveWidth, setLiveWidth] = useState<number | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const dragWidthRef = useRef<number | null>(null);
  const moveHandlerRef = useRef<((ev: MouseEvent) => void) | null>(null);
  const upHandlerRef = useRef<(() => void) | null>(null);
  const flyoutRef = useRef<HTMLElement>(null);

  const dismissFlyout = useCallback(() => dismissDockFlyout(), []);

  useDockFlyoutFocus(dockExpanded, flyoutRef, dismissFlyout);

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
      setIsResizing(false);
    };
  }, []);

  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = dockWidth;
      dragWidthRef.current = startWidth;
      setLiveWidth(startWidth);
      setIsResizing(true);

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
        setIsResizing(false);
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
    onOpenSettings,
    onCollapse: () => toggleDock()
  };

  const expandedPanel = (
    <nav
      ref={flyoutRef}
      role="dialog"
      aria-modal="true"
      aria-label="Workspace and session navigation"
      aria-expanded
      className={dockFlyoutShellClassName(isResizing)}
      style={{ width: `${expandedWidthPx}px` }}
    >
      <div className={cn(DOCK_INSET_CLASS, 'h-full gap-0 py-1')}>
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
        data-resizing={isResizing ? 'true' : undefined}
        onMouseDown={onResizeStart}
        className={DOCK_RESIZE_HANDLE_CLASS}
      />
    </nav>
  );

  const collapsedRail = (
    <nav
      aria-label="Workspace and session navigation rail"
      aria-expanded={false}
      className={DOCK_RAIL_PILL_CLASS}
    >
      <DockToolbar layout="vertical" dockStyle {...toolbarProps} collapseIcon="right" />
    </nav>
  );

  return (
    <>
      <DockExpandBackdrop />
      {dockExpanded ? expandedPanel : collapsedRail}
    </>
  );
}
