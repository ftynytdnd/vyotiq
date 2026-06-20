/**
 * LeftDock — inline navigation flyout panel (toolbar lives in titlebar).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { DockNavigator } from './DockNavigator.js';
import { DockSearchPopover } from './DockSearchPopover.js';
import {
  clampDockWidth,
  DOCK_INSET_CLASS,
  DOCK_EDGE_CONTAINER_CLASS,
  DOCK_RESIZE_HANDLE_CLASS,
  dockFlyoutShellClassName
} from './dockShared.js';
import { useDockShortcuts } from './useDockShortcuts.js';
import { useWorkspaceTreeWatcher } from '../../hooks/useWorkspaceTreeWatcher.js';
import { useUiStore } from '../../store/useUiStore.js';
import { useDockSearchStore } from '../../store/useDockSearchStore.js';
import { cn } from '../../lib/cn.js';

export interface LeftDockProps {
  onOpenWorkspace: () => void;
  onSetWorkspacePath: () => void;
  /** Flyout stays collapsed while settings is open. */
  settingsMode?: boolean;
}

export function LeftDock({
  onOpenWorkspace,
  onSetWorkspacePath,
  settingsMode = false
}: LeftDockProps) {
  useDockShortcuts();
  useWorkspaceTreeWatcher();

  const dockExpanded = useUiStore((s) => s.dockExpanded);
  const dockWidth = useUiStore((s) => s.dockWidth);
  const setDockExpanded = useUiStore((s) => s.setDockExpanded);
  const setDockWidth = useUiStore((s) => s.setDockWidth);

  const searchOpen = useDockSearchStore((s) => s.open);

  const [liveWidth, setLiveWidth] = useState<number | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const dragWidthRef = useRef<number | null>(null);
  const moveHandlerRef = useRef<((ev: MouseEvent) => void) | null>(null);
  const upHandlerRef = useRef<(() => void) | null>(null);

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

  const expandedPanel = (
    <nav
      aria-label="Workspace and session navigation"
      aria-expanded
      className={dockFlyoutShellClassName(isResizing)}
      style={{ width: `${expandedWidthPx}px` }}
    >
      <div className={cn(DOCK_INSET_CLASS, 'vx-dock-inset h-full py-1 pr-2')}>
        <DockSearchPopover />
        <DockNavigator
          onOpenWorkspace={onOpenWorkspace}
          onSetWorkspacePath={onSetWorkspacePath}
        />
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

  return (
    <div className={DOCK_EDGE_CONTAINER_CLASS}>
      {dockExpanded && !settingsMode ? expandedPanel : null}
    </div>
  );
}
