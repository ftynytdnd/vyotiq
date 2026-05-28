/**
 * EditDiffView — compatibility shim delegating to the shared `DiffViewer`.
 * Timeline edits, streaming panes, and file history keep this import path.
 */

import type { DiffHunk } from '@shared/types/tool.js';
import { DiffViewer } from '../../../diff/DiffViewer.js';
import type { DiffViewVariant } from './diff/DiffHunk.js';
import type { ReviewLinePickProps } from './diff/diffLinePick.js';

interface EditDiffViewProps {
  hunks: DiffHunk[];
  variant: DiffViewVariant;
  maxHeightClass?: string;
  linePick?: ReviewLinePickProps;
  showLayoutToggle?: boolean;
}

export function EditDiffView({
  hunks,
  variant,
  maxHeightClass,
  linePick,
  showLayoutToggle
}: EditDiffViewProps) {
  return (
    <DiffViewer
      hunks={hunks}
      variant={variant}
      showLayoutToggle={showLayoutToggle ?? variant !== 'partial'}
      {...(maxHeightClass ? { maxHeightClass } : {})}
      {...(linePick ? { linePick } : {})}
    />
  );
}
