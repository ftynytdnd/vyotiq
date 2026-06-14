/**
 * Preview canvas — dedicated attachment preview tab (image / PDF / text).
 * Non-previewable files open in the OS default app via PreviewZone.
 */

import { FileText } from 'lucide-react';
import { PreviewZone } from './PreviewZone.js';
import { useAttachmentPreviewStore } from '../../store/useAttachmentPreviewStore.js';
import { WORKBENCH_BODY_CLASS } from './workbenchShared.js';
import { cn } from '../../lib/cn.js';
import { SHELL_ACTION_ICON_STROKE } from '../../lib/shellIcons.js';

export function PreviewCanvas() {
  const attachment = useAttachmentPreviewStore((s) => s.attachment);

  if (attachment) {
    return <PreviewZone attachment={attachment} />;
  }

  return (
    <div
      className={cn(
        WORKBENCH_BODY_CLASS,
        'vx-preview-empty flex flex-col items-center justify-center gap-3 px-6 py-10 text-center'
      )}
    >
      <FileText className="h-8 w-8 text-text-faint" strokeWidth={SHELL_ACTION_ICON_STROKE} />
      <div className="max-w-sm space-y-1">
        <p className="text-section font-medium text-text-primary">Preview</p>
        <p className="text-row text-text-muted">
          Image, PDF, and text attachments open here. Other files launch in your default app.
        </p>
      </div>
    </div>
  );
}
