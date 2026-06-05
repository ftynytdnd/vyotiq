/**
 * Attachment button. Unified attach menu: workspace picker or system file
 * dialog. Workspace selections become `<attached_files>` in the orchestrator
 * context envelope; external files are copied under userData first.
 *
 * The picker body is hosted via the portal-based `Popover` primitive so
 * it escapes the composer's `overflow-hidden` clip.
 */

import { useEffect, useRef, useState } from 'react';
import { FolderOpen, HardDrive, Plus } from 'lucide-react';
import { Popover } from '../ui/Popover.js';
import { AttachmentPicker } from './AttachmentPicker.js';
import { cn } from '../../lib/cn.js';
import { chromeToolbarButtonClassName, appPopoverPanelClassName } from '../ui/SurfaceShell.js';
import { SHELL_CHROME_ICON_CLASS, SHELL_CHROME_ICON_STROKE } from '../../lib/shellIcons.js';

type AttachView = 'source' | 'workspace';

interface AttachmentButtonProps {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  selected: string[];
  onPick: (path: string) => void;
  onPickFolder?: (folderPath: string) => void;
  onPickFromComputer: () => void;
  disabled?: boolean;
  /** When true, skip the source menu and open the workspace picker directly. */
  workspaceOnly?: boolean;
  controlledFilter?: string;
  onControlledFilterChange?: (next: string) => void;
}

export function AttachmentButton({
  open,
  onOpen,
  onClose,
  selected,
  onPick,
  onPickFolder,
  onPickFromComputer,
  disabled = false,
  workspaceOnly = false,
  controlledFilter,
  onControlledFilterChange
}: AttachmentButtonProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [view, setView] = useState<AttachView>('source');
  const count = selected.length;
  const hasSelection = count > 0;

  useEffect(() => {
    if (!open) {
      setView(workspaceOnly ? 'workspace' : 'source');
    } else if (workspaceOnly) {
      setView('workspace');
    }
  }, [open, workspaceOnly]);

  const title = disabled
    ? 'Start a chat before attaching files'
    : hasSelection
      ? `Attach files · ${count} selected`
      : 'Attach files';

  const handleOpen = () => {
    if (disabled) return;
    if (open) {
      onClose();
      return;
    }
    if (workspaceOnly) {
      setView('workspace');
    } else {
      setView('source');
    }
    onOpen();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={handleOpen}
        aria-label={hasSelection ? `Attach files, ${count} selected` : 'Attach files'}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={title}
        disabled={disabled}
        className={cn(
          chromeToolbarButtonClassName(open || hasSelection),
          'shrink-0',
          disabled && 'cursor-not-allowed opacity-45',
          hasSelection ? 'gap-0.5 px-1' : 'h-[1.625rem] w-[1.625rem] px-0'
        )}
      >
        <Plus className={SHELL_CHROME_ICON_CLASS} strokeWidth={SHELL_CHROME_ICON_STROKE} />
        {hasSelection && (
          <span className="font-mono text-chat-meta text-text-secondary">{count}</span>
        )}
      </button>
      <Popover open={open} onClose={onClose} triggerRef={triggerRef} align="start">
        {view === 'source' ? (
          <div className={cn(appPopoverPanelClassName, 'min-w-[12rem] p-1')}>
            <button
              type="button"
              className="vx-menu-row flex w-full items-center gap-2 rounded-inner px-2 py-1.5 text-left text-row hover:bg-chrome-hover-soft/60"
              onClick={() => setView('workspace')}
            >
              <FolderOpen className={SHELL_CHROME_ICON_CLASS} strokeWidth={SHELL_CHROME_ICON_STROKE} />
              From workspace
            </button>
            <button
              type="button"
              className="vx-menu-row flex w-full items-center gap-2 rounded-inner px-2 py-1.5 text-left text-row hover:bg-chrome-hover-soft/60"
              onClick={() => {
                onClose();
                onPickFromComputer();
              }}
            >
              <HardDrive className={SHELL_CHROME_ICON_CLASS} strokeWidth={SHELL_CHROME_ICON_STROKE} />
              From computer
            </button>
          </div>
        ) : (
          <AttachmentPicker
            open={open}
            onClose={onClose}
            selected={selected}
            onPick={onPick}
            {...(onPickFolder ? { onPickFolder } : {})}
            {...(controlledFilter !== undefined ? { controlledFilter } : {})}
            {...(onControlledFilterChange ? { onControlledFilterChange } : {})}
          />
        )}
      </Popover>
    </>
  );
}
