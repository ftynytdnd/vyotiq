/**
 * Virtualized window rows for large capture source lists.
 */

import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef } from 'react';
import { AppWindow } from 'lucide-react';
import type { CaptureSourceInfo } from '@shared/types/capture.js';
import {
  CAPTURE_PICKER_ROW_HEIGHT_PX,
  CAPTURE_PICKER_WINDOW_LIST_MAX_HEIGHT_PX
} from '@shared/capture/capturePickerConstants.js';
import { captureNavSubtitle } from './capturePickerModel.js';
import { CapturePickerRow } from './CapturePickerRow.js';

interface CapturePickerWindowListProps {
  windows: CaptureSourceInfo[];
  capturing: boolean;
  capturingRowId: string | null;
  activeNavId: string;
  onActiveNavId: (id: string) => void;
  onCaptureSource: (sourceId: string, rowId: string) => void;
}

export function CapturePickerWindowList({
  windows,
  capturing,
  capturingRowId,
  activeNavId,
  onActiveNavId,
  onCaptureSource
}: CapturePickerWindowListProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: windows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => CAPTURE_PICKER_ROW_HEIGHT_PX,
    overscan: 4
  });

  const listHeight = Math.min(
    CAPTURE_PICKER_WINDOW_LIST_MAX_HEIGHT_PX,
    windows.length * CAPTURE_PICKER_ROW_HEIGHT_PX
  );

  return (
    <div
      ref={parentRef}
      className="vx-capture-picker-window-scroll"
      style={{ maxHeight: listHeight }}
      onWheel={(e) => e.stopPropagation()}
    >
      <div
        className="vx-capture-picker-window-scroll__inner"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((item) => {
          const source = windows[item.index]!;
          const rowId = `window:${source.id}`;
          return (
            <div
              key={source.id}
              className="vx-capture-picker-window-scroll__row"
              style={{
                height: item.size,
                transform: `translateY(${item.start}px)`
              }}
            >
              <CapturePickerRow
                rowId={rowId}
                label={source.name}
                subtitle={captureNavSubtitle(source.id)}
                thumbnailSrc={source.thumbnailDataUrl}
                icon={AppWindow}
                disabled={capturing}
                active={activeNavId === rowId}
                capturing={capturingRowId === rowId}
                onFocus={() => onActiveNavId(rowId)}
                onClick={() => onCaptureSource(source.id, rowId)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
