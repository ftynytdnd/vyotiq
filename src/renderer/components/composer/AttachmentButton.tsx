/**
 * Attach external files from outside the workspace via the system file dialog.
 * Workspace files and folders are added through `@` mentions in the composer.
 */

import { Plus } from 'lucide-react';
import { attachmentIngestLimitHint } from '@shared/attachments/attachmentSizeLimits.js';
import { cn } from '../../lib/cn.js';
import { chromeToolbarButtonClassName } from '../ui/SurfaceShell.js';
import { SHELL_CHROME_ICON_CLASS, SHELL_CHROME_ICON_STROKE } from '../../lib/shellIcons.js';

interface AttachmentButtonProps {
  onPickFromComputer: () => void;
  disabled?: boolean;
}

export function AttachmentButton({
  onPickFromComputer,
  disabled = false
}: AttachmentButtonProps) {
  const title = disabled
    ? 'Start a chat before attaching files'
    : attachmentIngestLimitHint();
  const ariaLabel = disabled ? title : 'Attach file from computer';

  return (
    <button
      type="button"
      onClick={() => {
        if (disabled) return;
        onPickFromComputer();
      }}
      aria-label={ariaLabel}
      title={title}
      disabled={disabled}
      className={cn(
        chromeToolbarButtonClassName(false),
        'h-[1.625rem] w-[1.625rem] shrink-0 px-0',
        disabled && 'cursor-not-allowed opacity-45'
      )}
    >
      <Plus className={SHELL_CHROME_ICON_CLASS} strokeWidth={SHELL_CHROME_ICON_STROKE} />
    </button>
  );
}
