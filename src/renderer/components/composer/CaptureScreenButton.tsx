/**
 * Screen capture button — opens a portaled capture picker anchored to the camera icon.
 */

import { useEffect, useRef, useState } from 'react';
import { Camera, Loader2 } from 'lucide-react';
import { cn } from '../../lib/cn.js';
import { chromeToolbarButtonClassName } from '../ui/SurfaceShell.js';
import { SHELL_CHROME_ICON_CLASS, SHELL_CHROME_ICON_STROKE } from '../../lib/shellIcons.js';
import { Popover } from '../ui/Popover.js';
import type { PromptAttachmentMeta } from '@shared/types/chat.js';
import { CapturePickerPanel } from './capture/CapturePickerPanel.js';
import { useCapturePicker } from './capture/useCapturePicker.js';
import { useModelPickerCollisionPadding } from './modelPicker/useModelPickerCollisionPadding.js';
import { PANEL_IDS } from '@shared/panels/panelWidths.js';

const CAPTURE_PICKER_FIT_MAX_WIDTH_PX = 360;

interface CaptureScreenButtonProps {
  disabled?: boolean;
  conversationId: string | null;
  messageId: string;
  onIngested: (meta: PromptAttachmentMeta) => void;
}

export function CaptureScreenButton({
  disabled = false,
  conversationId,
  messageId,
  onIngested
}: CaptureScreenButtonProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const collisionPadding = useModelPickerCollisionPadding();
  const picker = useCapturePicker({ disabled, conversationId, messageId, onIngested });
  const [popoverRevision, setPopoverRevision] = useState(0);

  useEffect(() => {
    if (!picker.open) return;
    let frame = 0;
    let pass = 0;
    const remeasure = () => {
      setPopoverRevision((r) => r + 1);
      pass += 1;
      if (pass < 3) frame = requestAnimationFrame(remeasure);
    };
    frame = requestAnimationFrame(remeasure);
    return () => cancelAnimationFrame(frame);
  }, [
    picker.open,
    picker.loading,
    picker.showSkeleton,
    picker.sources.length
  ]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => picker.togglePicker()}
        onPointerEnter={() => picker.prefetchSources()}
        onPointerLeave={() => picker.cancelPrefetch()}
        onFocus={() => picker.prefetchSources()}
        aria-label="Capture screen or window"
        title="Capture screen or window"
        aria-expanded={picker.open}
        aria-haspopup="menu"
        data-e2e-capture-button=""
        disabled={disabled || picker.capturing}
        className={cn(
          chromeToolbarButtonClassName(picker.open),
          'h-[1.625rem] w-[1.625rem] shrink-0 px-0',
          (disabled || picker.capturing) && 'cursor-not-allowed opacity-45'
        )}
      >
        {picker.capturing ? (
          <Loader2
            className={cn(SHELL_CHROME_ICON_CLASS, 'animate-spin')}
            strokeWidth={SHELL_CHROME_ICON_STROKE}
          />
        ) : (
          <Camera className={SHELL_CHROME_ICON_CLASS} strokeWidth={SHELL_CHROME_ICON_STROKE} />
        )}
      </button>
      <Popover
        open={picker.pickerVisible}
        onClose={() => picker.closePicker()}
        triggerRef={triggerRef}
        preferSide="auto"
        align="start"
        offset={8}
        zIndex={80}
        collisionPadding={collisionPadding}
        revision={popoverRevision}
        fitMaxWidth={CAPTURE_PICKER_FIT_MAX_WIDTH_PX}
        widthMode="panel"
        panelId={PANEL_IDS.CAPTURE_PICKER}
        containScroll
        className="vx-capture-picker-popover"
      >
        <CapturePickerPanel
          loading={picker.loading}
          showSkeleton={picker.showSkeleton}
          loadingThumbnails={picker.loadingThumbnails}
          capturing={picker.capturing}
          capturingRowId={picker.capturingRowId}
          sources={picker.sources}
          activeNavId={picker.activeNavId}
          onActiveNavIdChange={picker.setActiveNavId}
          query={picker.query}
          onQueryChange={picker.setQuery}
          onCaptureAppWindow={() => void picker.captureAppWindow()}
          onCaptureSource={(id, rowId) => void picker.captureSource(id, rowId)}
          onClose={() => picker.closePicker()}
        />
      </Popover>
    </>
  );
}
