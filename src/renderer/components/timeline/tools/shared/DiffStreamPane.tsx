/**
 * Shared live diff block for edit/bash/delete/report streaming previews.
 */

import type { DiffStreamSnapshot } from '../../reducer/types.js';
import { EditDiffView } from '../edit/EditDiffView.js';

interface DiffStreamPaneProps {
  diffStream: DiffStreamSnapshot;
  /** Status chip on the file card header. */
  label: string;
}

export function DiffStreamPane({ diffStream, label }: DiffStreamPaneProps) {
  return (
    <EditDiffView
      hunks={diffStream.hunks}
      variant={diffStream.settled ? 'authoritative' : 'partial'}
      filePath={diffStream.filePath}
      additions={diffStream.additions}
      deletions={diffStream.deletions}
      pending={!diffStream.settled}
      statusLabel={label}
    />
  );
}
