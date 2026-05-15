/**
 * Attachment button. Opens the workspace file picker; selections become
 * `<attached_files>` in the orchestrator's context envelope.
 *
 * The picker body is hosted via the portal-based `Popover` primitive so
 * it escapes the composer's `overflow-hidden` clip. Outside-click,
 * Escape, and resize/scroll re-anchoring are handled by `Popover`.
 */

import { useRef } from 'react';
import { Plus } from 'lucide-react';
import { Popover } from '../ui/Popover.js';
import { AttachmentPicker } from './AttachmentPicker.js';
import { cn } from '../../lib/cn.js';

interface AttachmentButtonProps {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  selected: string[];
  onPick: (path: string) => void;
  /**
   * Optional controlled-filter passthrough for the embedded picker. When
   * the Composer's `@`-mention trigger is driving the popover, the parent
   * supplies these to keep the textarea token and the picker in lockstep.
   */
  controlledFilter?: string;
  onControlledFilterChange?: (next: string) => void;
}

export function AttachmentButton({
  open,
  onOpen,
  onClose,
  selected,
  onPick,
  controlledFilter,
  onControlledFilterChange
}: AttachmentButtonProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const count = selected.length;
  const hasSelection = count > 0;
  // Persistent attachment count, so the user can confirm `@`-mention
  // landings or a previous pick without scanning the chip strip
  // (which may be wrapping off-screen or scrolled out of view).
  const title = hasSelection
    ? `Attach files from workspace · ${count} selected`
    : 'Attach files from workspace';
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? onClose() : onOpen())}
        aria-label={
          hasSelection
            ? `Attach files from workspace, ${count} selected`
            : 'Attach files from workspace'
        }
        aria-haspopup="dialog"
        aria-expanded={open}
        title={title}
        className={cn(
          'app-no-drag inline-flex h-6 shrink-0 items-center justify-center rounded-inner',
          'bg-surface-overlay text-text-muted transition-colors duration-150',
          'hover:bg-surface-hover hover:text-text-primary',
          open && 'bg-surface-hover text-text-primary',
          hasSelection ? 'gap-0.5 px-1' : 'w-6'
        )}
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={2.25} />
        {hasSelection && (
          <span className="font-mono text-meta text-text-secondary">{count}</span>
        )}
      </button>
      <Popover
        open={open}
        onClose={onClose}
        triggerRef={triggerRef}
        align="start"
      >
        <AttachmentPicker
          open={open}
          onClose={onClose}
          selected={selected}
          onPick={onPick}
          {...(controlledFilter !== undefined ? { controlledFilter } : {})}
          {...(onControlledFilterChange ? { onControlledFilterChange } : {})}
        />
      </Popover>
    </>
  );
}
