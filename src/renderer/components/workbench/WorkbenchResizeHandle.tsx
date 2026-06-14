/**
 * Draggable split between agent column and workbench side pane.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { clampWorkbenchPaneWidth } from '@shared/workbench/workbenchPaneWidth.js';
import { useUiStore } from '../../store/useUiStore.js';
import { WORKBENCH_RESIZE_HANDLE_CLASS } from './workbenchShared.js';

interface WorkbenchResizeHandleProps {
  onLiveWidth: (width: number | null) => void;
}

export function WorkbenchResizeHandle({ onLiveWidth }: WorkbenchResizeHandleProps) {
  const workbenchPaneWidth = useUiStore((s) => s.workbenchPaneWidth);
  const setWorkbenchPaneWidth = useUiStore((s) => s.setWorkbenchPaneWidth);
  const [isResizing, setIsResizing] = useState(false);
  const dragWidthRef = useRef<number | null>(null);
  const moveHandlerRef = useRef<((ev: MouseEvent) => void) | null>(null);
  const upHandlerRef = useRef<(() => void) | null>(null);

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
      onLiveWidth(null);
    };
  }, [onLiveWidth]);

  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = workbenchPaneWidth;
      dragWidthRef.current = startWidth;
      onLiveWidth(startWidth);
      setIsResizing(true);

      const onMove = (ev: MouseEvent) => {
        const next = clampWorkbenchPaneWidth(startWidth + (startX - ev.clientX));
        dragWidthRef.current = next;
        onLiveWidth(next);
      };

      const onUp = () => {
        moveHandlerRef.current = null;
        upHandlerRef.current = null;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        if (dragWidthRef.current !== null) {
          setWorkbenchPaneWidth(dragWidthRef.current);
        }
        dragWidthRef.current = null;
        onLiveWidth(null);
        setIsResizing(false);
        window.dispatchEvent(new Event('resize'));
      };

      moveHandlerRef.current = onMove;
      upHandlerRef.current = onUp;
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [onLiveWidth, setWorkbenchPaneWidth, workbenchPaneWidth]
  );

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize workbench pane"
      className={WORKBENCH_RESIZE_HANDLE_CLASS}
      data-resizing={isResizing ? 'true' : undefined}
      onMouseDown={onResizeStart}
    />
  );
}
