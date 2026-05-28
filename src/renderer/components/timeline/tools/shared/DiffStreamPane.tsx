/**
 * Shared live diff block for edit/bash/delete/report streaming previews.
 */

import type { DiffStreamSnapshot } from '../../reducer/types.js';
import { DetailPane } from './DetailPane.js';
import { DiffStatsBadge } from './DiffStatsBadge.js';
import { EditDiffView } from '../edit/EditDiffView.js';

interface DiffStreamPaneProps {
  diffStream: DiffStreamSnapshot;
  /** DetailPane label, e.g. `streaming diff` or `streaming removal`. */
  label: string;
}

export function DiffStreamPane({ diffStream, label }: DiffStreamPaneProps) {
  return (
    <>
      <div className="flex items-center gap-2 text-row text-text-muted">
        <span className="font-mono truncate" title={diffStream.filePath}>
          {diffStream.filePath}
        </span>
        <DiffStatsBadge
          additions={diffStream.additions}
          deletions={diffStream.deletions}
          pending={!diffStream.settled}
        />
      </div>
      <DetailPane label={label}>
        <EditDiffView
          key={diffStream.settled ? 'diff-stream-settled' : 'diff-stream-live'}
          hunks={diffStream.hunks}
          variant={diffStream.settled ? 'authoritative' : 'partial'}
        />
      </DetailPane>
    </>
  );
}
