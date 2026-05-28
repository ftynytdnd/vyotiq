/**
 * Renders a checkpoint entry's diff via the shared `UnifiedDiffPanel`.
 */

import type { CheckpointChangeKind } from '@shared/types/checkpoint.js';
import { UnifiedDiffPanel } from '../diff/UnifiedDiffPanel.js';

interface PendingChangeDiffProps {
  workspaceId: string;
  kind: CheckpointChangeKind;
  preHash?: string;
  postHash?: string;
  /** Taller diff container for review modal (full-screen comfortable). */
  maxHeightClass?: string;
}

export function PendingChangeDiff({
  workspaceId,
  kind,
  preHash,
  postHash,
  maxHeightClass
}: PendingChangeDiffProps) {
  return (
    <UnifiedDiffPanel
      workspaceId={workspaceId}
      kind={kind}
      {...(preHash ? { preHash } : {})}
      {...(postHash ? { postHash } : {})}
      variant="authoritative"
      {...(maxHeightClass ? { maxHeightClass } : {})}
    />
  );
}
