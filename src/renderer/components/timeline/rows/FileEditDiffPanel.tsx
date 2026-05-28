/**
 * Inline diff for a file-edit group child — resolves checkpoint pending
 * entry by `entryId` and renders via `UnifiedDiffPanel`.
 */

import { UnifiedDiffPanel } from '../../diff/UnifiedDiffPanel.js';
import { usePendingEntryState } from '../../checkpoints/shared/usePendingEntryState.js';
import { chromeInsetNoteClassName } from '../../ui/SurfaceShell.js';

interface FileEditDiffPanelProps {
  entryId?: string;
  filePath: string;
  runId?: string;
  subagentId?: string;
}

export function FileEditDiffPanel({
  entryId,
  filePath,
  runId,
  subagentId
}: FileEditDiffPanelProps) {
  const pending = usePendingEntryState({ entryId, filePath, runId, subagentId });

  if (!pending) {
    return (
      <div className={chromeInsetNoteClassName}>
        Diff preview unavailable — open Checkpoints for full detail.
      </div>
    );
  }

  return (
    <UnifiedDiffPanel
      workspaceId={pending.workspaceId}
      kind={pending.kind}
      {...(pending.preHash ? { preHash: pending.preHash } : {})}
      {...(pending.postHash ? { postHash: pending.postHash } : {})}
      variant="authoritative"
      maxHeightClass="max-h-64"
    />
  );
}
