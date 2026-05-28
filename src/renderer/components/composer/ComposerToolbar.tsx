import type { ReactNode } from 'react';
import { Mic } from 'lucide-react';
import type { ModelSelection } from '@shared/types/provider.js';
import { AttachmentButton } from './AttachmentButton.js';
import { PermissionsMenu } from './PermissionsMenu.js';
import { ModelPicker } from './modelPicker/index.js';
import { SendButton } from './SendButton.js';
import { chromeEdgeClassName, chromeIconPillClassName } from '../ui/SurfaceShell.js';
import { cn } from '../../lib/cn.js';

interface ComposerToolbarProps {
  model: ModelSelection | null;
  onModelChange: (sel: ModelSelection) => void;
  sendState: 'idle' | 'ready' | 'processing';
  onSend: () => void;
  canSend: boolean;

  attachments: string[];
  attachmentPickerOpen: boolean;
  onOpenAttachments: () => void;
  onCloseAttachments: () => void;
  onPickAttachment: (path: string) => void;
  /** Forwarded to `AttachmentPicker` so the Composer's `@`-mention
   *  trigger can drive the popover filter from the textarea. */
  attachmentFilter?: string;
  onAttachmentFilterChange?: (next: string) => void;
  tokenUsageSlot?: ReactNode;
  /** Narrow layout when the secondary zone is open. */
  compact?: boolean;
  /** Flush inside the unified chat footer — tighter chrome. */
  footerMode?: boolean;

  /** Routes the user to Settings → Providers when the model picker is
   *  clicked while no enabled provider has any models. */
  onOpenProviders: () => void;
}

export function ComposerToolbar({
  model,
  onModelChange,
  sendState,
  onSend,
  canSend,
  attachments,
  attachmentPickerOpen,
  onOpenAttachments,
  onCloseAttachments,
  onPickAttachment,
  attachmentFilter,
  onAttachmentFilterChange,
  tokenUsageSlot,
  compact = false,
  footerMode = false,
  onOpenProviders
}: ComposerToolbarProps) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1',
        footerMode
          ? 'border-t px-2 py-1'
          : 'border-t px-2 py-1',
        chromeEdgeClassName
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-0.5">
        <AttachmentButton
          open={attachmentPickerOpen}
          onOpen={onOpenAttachments}
          onClose={onCloseAttachments}
          selected={attachments}
          onPick={onPickAttachment}
          {...(attachmentFilter !== undefined ? { controlledFilter: attachmentFilter } : {})}
          {...(onAttachmentFilterChange ? { onControlledFilterChange: onAttachmentFilterChange } : {})}
        />
        <PermissionsMenu />
        <button
          type="button"
          disabled
          title="Voice input is not available yet"
          aria-label="Voice input (not available)"
          className={cn(
            chromeIconPillClassName(), 'cursor-not-allowed opacity-50'
          )}
        >
          <Mic className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
        </button>
      </div>
      <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1">
        <div className="min-w-0 shrink">
          <ModelPicker
            value={model}
            onChange={onModelChange}
            onOpenProviders={onOpenProviders}
          />
        </div>
        <SendButton
          onClick={onSend}
          state={sendState}
          disabled={!canSend && sendState !== 'processing'}
        />
        {tokenUsageSlot && (
          <div
            className={cn(
              'flex min-w-0 max-w-[12rem] shrink-0 items-center overflow-hidden',
              compact && 'max-w-[10rem]'
            )}
          >
            {tokenUsageSlot}
          </div>
        )}
      </div>
    </div>
  );
}

