/**
 * LeftDock — persistent edge strip + inline navigation panel.
 * Toolbar actions live on the strip; the panel holds search, lists, and resize.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { DockSearchPopover } from './DockSearchPopover.js';
import { DockToolbar } from './DockToolbar.js';
import { DockWorkspaceTabs } from './DockWorkspaceTabs.js';
import { DockWorkspacePanel } from './DockWorkspacePanel.js';
import { DockSectionHeader } from './DockSectionHeader.js';
import {
  clampDockWidth,
  DOCK_INSET_CLASS,
  DOCK_EDGE_CONTAINER_CLASS,
  DOCK_EDGE_STRIP_CLASS,
  DOCK_RESIZE_HANDLE_CLASS,
  dockFlyoutShellClassName,
  dockInlineActionClassName,
  beginNewChatFromDock,
  workspacePanelClassName
} from './dockShared.js';
import { useDockShortcuts } from './useDockShortcuts.js';
import { useUiStore } from '../../store/useUiStore.js';
import { useDockSearchStore } from '../../store/useDockSearchStore.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { useWorkbenchActive } from '../workbench/useWorkbenchActive.js';
import { cn } from '../../lib/cn.js';

export interface LeftDockProps {
  onOpenSettings: () => void;
  onOpenWorkspace: () => void;
  onSetWorkspacePath: () => void;
  /** Strip-only mode — flyout stays collapsed; gear becomes back. */
  settingsMode?: boolean;
  onBackFromSettings?: () => void;
}

export function LeftDock({
  onOpenSettings,
  onOpenWorkspace,
  onSetWorkspacePath,
  settingsMode = false,
  onBackFromSettings
}: LeftDockProps) {
  useDockShortcuts();

  const dockExpanded = useUiStore((s) => s.dockExpanded);
  const dockWidth = useUiStore((s) => s.dockWidth);
  const toggleDock = useUiStore((s) => s.toggleDock);
  const setDockExpanded = useUiStore((s) => s.setDockExpanded);
  const setDockWidth = useUiStore((s) => s.setDockWidth);

  const toggleSearch = useDockSearchStore((s) => s.toggle);
  const searchOpen = useDockSearchStore((s) => s.open);

  const activeWorkspaceId = useWorkspaceStore((s) => s.activeId);
  const workspaces = useWorkspaceStore((s) => s.list);
  const workbenchActive = useWorkbenchActive();

  const [liveWidth, setLiveWidth] = useState<number | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const dragWidthRef = useRef<number | null>(null);
  const moveHandlerRef = useRef<((ev: MouseEvent) => void) | null>(null);
  const upHandlerRef = useRef<(() => void) | null>(null);

  const handleToggleSearch = () => {
    if (settingsMode) return;
    if (!dockExpanded) setDockExpanded(true);
    toggleSearch();
  };

  const handleToggleDock = () => {
    if (settingsMode) return;
    toggleDock();
  };

  const handleExpandDock = () => {
    if (settingsMode) return;
    setDockExpanded(true);
  };

  useEffect(() => {
    if (!dockExpanded && searchOpen) {
      useDockSearchStore.getState().setOpen(false);
    }
  }, [dockExpanded, searchOpen]);

  useEffect(() => {
    if (!settingsMode) return;
    if (dockExpanded) setDockExpanded(false);
    if (searchOpen) useDockSearchStore.getState().setOpen(false);
  }, [settingsMode, dockExpanded, searchOpen, setDockExpanded]);

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
    onNewChat: () => {
      if (settingsMode) return;
      void beginNewChatFromDock();
    },
    onToggleSearch: handleToggleSearch,
    onOpenSettings,
    onCollapse: () => handleToggleDock(),
    settingsMode,
    onBackFromSettings
  };

  const expandedPanel = (
    <nav
      aria-label="Workspace and session navigation"
      aria-expanded
      className={dockFlyoutShellClassName(isResizing)}
      style={{ width: `${expandedWidthPx}px` }}
    >
      <div className={cn(DOCK_INSET_CLASS, 'h-full gap-1.5 py-1 pr-2')}>
        <DockSearchPopover />
        <div className={workspacePanelClassName(workspaces.length)}>
          <DockSectionHeader
            label="Workspaces"
            compact={workbenchActive}
            actions={
              <>
                <button
                  type="button"
                  className={dockInlineActionClassName()}
                  title="Open workspace folder (Ctrl+O)"
                  onClick={onOpenWorkspace}
                >
                  Open…
                </button>
                <button
                  type="button"
                  className={dockInlineActionClassName()}
                  title="Set workspace folder by path"
                  onClick={onSetWorkspacePath}
                >
                  Set path…
                </button>
              </>
            }
          />
          <DockWorkspaceTabs />
        </div>
        <DockWorkspacePanel workspaceId={activeWorkspaceId} />
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

  const edgeStrip = (
    <nav
      aria-label="Workspace and session navigation rail"
      aria-expanded={dockExpanded}
      className={DOCK_EDGE_STRIP_CLASS}
    >
      <DockToolbar
        layout="vertical"
        dockStyle
        {...toolbarProps}
        collapseIcon={dockExpanded ? 'left' : 'right'}
        onCollapse={() => (dockExpanded ? handleToggleDock() : handleExpandDock())}
      />
    </nav>
  );

  return (
    <div className={DOCK_EDGE_CONTAINER_CLASS}>
      {edgeStrip}
      {dockExpanded && !settingsMode ? expandedPanel : null}
    </div>
  );
}
