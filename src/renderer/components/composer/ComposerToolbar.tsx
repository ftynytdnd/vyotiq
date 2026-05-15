import type { ReactNode } from 'react';
import type { ModelSelection } from '@shared/types/provider.js';
import { AttachmentButton } from './AttachmentButton.js';
import { PermissionsMenu } from './PermissionsMenu.js';
import { ModelPicker } from './modelPicker/index.js';
import { SendButton } from './SendButton.js';

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
  onOpenProviders
}: ComposerToolbarProps) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 rounded-inner bg-surface-raised px-1 py-1">
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
      </div>
      <div className="ml-auto flex min-w-0 max-w-full items-center justify-end gap-0.5">
        {tokenUsageSlot && (
          <div className="flex shrink-0 items-center">
            {tokenUsageSlot}
          </div>
        )}
        <ModelPicker
          value={model}
          onChange={onModelChange}
          onOpenProviders={onOpenProviders}
        />
        <SendButton onClick={onSend} state={sendState} disabled={!canSend && sendState !== 'processing'} />
      </div>
    </div>
  );
}
