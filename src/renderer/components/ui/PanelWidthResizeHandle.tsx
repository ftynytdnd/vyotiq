/**
 * East-edge drag handle for resizable floating popover panels.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { clampPanelWidth } from '@shared/panels/panelWidths.js';
import { cn } from '../../lib/cn.js';

interface PanelWidthResizeHandleProps {
  width: number;
  onLiveWidth: (width: number | null) => void;
  onCommit: (width: number) => void;
}

export function PanelWidthResizeHandle({
  width,
  onLiveWidth,
  onCommit
}: PanelWidthResizeHandleProps) {
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
      e.stopPropagation();
      const startX = e.clientX;
      const startWidth = width;
      dragWidthRef.current = startWidth;
      onLiveWidth(startWidth);
      setIsResizing(true);

      const onMove = (ev: MouseEvent) => {
        const next = clampPanelWidth(startWidth + (ev.clientX - startX));
        dragWidthRef.current = next;
        onLiveWidth(next);
      };

      const onUp = () => {
        moveHandlerRef.current = null;
        upHandlerRef.current = null;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        if (dragWidthRef.current !== null) {
          onCommit(dragWidthRef.current);
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
    [onCommit, onLiveWidth, width]
  );

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panel width"
      className={cn(
        'absolute bottom-0 right-0 top-0 z-10 w-1.5 cursor-ew-resize',
        'transition-colors hover:bg-chrome-hover-soft',
        isResizing && 'bg-chrome-hover-soft'
      )}
      data-resizing={isResizing ? 'true' : undefined}
      onMouseDown={onResizeStart}
    />
  );
}
