/**
 * Terminal toolbar overflow — secondary shell actions behind one control.
 */

import { useRef, useState } from 'react';
import {
  ChevronsDown,
  ClipboardCopy,
  Ellipsis,
  Eraser,
  RotateCcw
} from 'lucide-react';
import { Popover } from '../ui/Popover.js';
import { chromePopoverPanelClassName } from '../ui/SurfaceShell.js';
import { cn } from '../../lib/cn.js';
import { SHELL_ACTION_ICON_STROKE, SHELL_ROW_ICON_CLASS } from '../../lib/shellIcons.js';
import {
  WORKBENCH_ICON_BTN_CLASS,
  workbenchToolbarToggleClass
} from './workbenchChrome.js';

interface TerminalOverflowMenuProps {
  disabled?: boolean;
  onCopy: () => void;
  onScrollBottom: () => void;
  onClear: () => void;
  onRestart: () => void;
}

export function TerminalOverflowMenu({
  disabled = false,
  onCopy,
  onScrollBottom,
  onClear,
  onRestart
}: TerminalOverflowMenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const rows = [
    { key: 'copy', label: 'Copy selection', action: onCopy, icon: ClipboardCopy },
    { key: 'scroll', label: 'Scroll to bottom', action: onScrollBottom, icon: ChevronsDown },
    { key: 'clear', label: 'Clear', action: onClear, icon: Eraser },
    { key: 'restart', label: 'Restart shell', action: onRestart, icon: RotateCcw }
  ] as const;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={cn(WORKBENCH_ICON_BTN_CLASS, workbenchToolbarToggleClass(open))}
        title="More terminal actions"
        aria-label="More terminal actions"
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <Ellipsis className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        triggerRef={triggerRef}
        align="end"
        preferSide="bottom"
        anchorStrict
        widthMode="content"
        fitMaxWidth={220}
        zIndex={60}
      >
        <div
          role="menu"
          aria-label="Terminal actions"
          className={cn(chromePopoverPanelClassName, 'vx-terminal-overflow-menu min-w-[10rem] p-1')}
        >
          {rows.map((row) => {
            const Icon = row.icon;
            return (
              <button
                key={row.key}
                type="button"
                role="menuitem"
                className="vx-btn vx-btn-quiet flex w-full items-center gap-2 rounded-inner px-2 py-1.5 text-left text-row text-text-secondary"
                onClick={() => {
                  setOpen(false);
                  row.action();
                }}
              >
                <Icon className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} aria-hidden />
                <span>{row.label}</span>
              </button>
            );
          })}
        </div>
      </Popover>
    </>
  );
}
