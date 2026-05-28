import type { ModelSelection } from '@shared/types/provider.js';
import { AttachmentButton } from './AttachmentButton.js';
import { PermissionModePill } from './PermissionModePill.js';
import { ModelPicker } from './modelPicker/index.js';
import { SendButton } from './SendButton.js';
import { cn } from '../../lib/cn.js';

interface ComposerToolbarProps {
  model: ModelSelection | null;
  onModelChange: (sel: ModelSelection) => void;
  sendState: 'idle' | 'ready' | 'processing';
  onSend: () => void;
  canSend: boolean;

  selectedPaths: string[];
  attachmentPickerOpen: boolean;
  onOpenAttachments: () => void;
  onCloseAttachments: () => void;
  onPickAttachment: (path: string) => void;
  onPickFromComputer: () => void;
  attachmentFilter?: string;
  onAttachmentFilterChange?: (next: string) => void;
  onOpenProviders: () => void;
  /** Vertical icon rail left of the textarea. */
  side?: 'left' | 'footer';
  compact?: boolean;
}

export function ComposerToolbar({
  model,
  onModelChange,
  sendState,
  onSend,
  canSend,
  selectedPaths,
  attachmentPickerOpen,
  onOpenAttachments,
  onCloseAttachments,
  onPickAttachment,
  onPickFromComputer,
  attachmentFilter,
  onAttachmentFilterChange,
  onOpenProviders,
  side = 'footer',
  compact = false
}: ComposerToolbarProps) {
  const leftRail = side === 'left';

  return (
    <div
      className={cn(
        'vx-composer-toolbar min-w-0',
        leftRail
          ? 'flex shrink-0 flex-col items-center gap-1 self-end pb-1'
          : 'flex min-w-0 flex-1 items-center gap-1',
        !leftRail && compact && 'vx-composer-toolbar--compact'
      )}
    >
      <div
        className={cn(
          'flex min-w-0 gap-1',
          leftRail ? 'flex-col items-center' : 'flex-1 items-center'
        )}
      >
        <div className={cn('min-w-0', !leftRail && 'shrink')}>
          <ModelPicker
            value={model}
            onChange={onModelChange}
            onOpenProviders={onOpenProviders}
          />
        </div>
        <AttachmentButton
          open={attachmentPickerOpen}
          onOpen={onOpenAttachments}
          onClose={onCloseAttachments}
          selected={selectedPaths}
          onPick={onPickAttachment}
          onPickFromComputer={onPickFromComputer}
          workspaceOnly={attachmentFilter !== undefined}
          {...(attachmentFilter !== undefined ? { controlledFilter: attachmentFilter } : {})}
          {...(onAttachmentFilterChange ? { onControlledFilterChange: onAttachmentFilterChange } : {})}
        />
        <PermissionModePill />
      </div>
      {!leftRail && (
        <SendButton
          onClick={onSend}
          state={sendState}
          disabled={!canSend && sendState !== 'processing'}
        />
      )}
    </div>
  );
}
