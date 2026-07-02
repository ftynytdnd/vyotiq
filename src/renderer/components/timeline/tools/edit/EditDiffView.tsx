/**
 * Timeline edit diff — per-file change card with syntax-highlighted snippets.
 * Falls back to the unified `DiffViewer` when review line-pick is requested.
 */

import type { DiffHunk } from '@shared/types/tool.js';
import { FileChangeCard } from '../../../diff/FileChangeCard.js';
import { SnippetDiffBody } from '../../../diff/SnippetDiffBody.js';
import { DiffViewer } from '../../../diff/DiffViewer.js';
import { openWorkspaceFile } from '../../../../lib/openPath.js';
import { useWorkspaceStore } from '../../../../store/useWorkspaceStore.js';
import type { DiffViewVariant } from './diff/DiffHunk.js';
import type { ReviewLinePickProps } from './diff/diffLinePick.js';

interface EditDiffViewProps {
  hunks: DiffHunk[];
  variant: DiffViewVariant;
  filePath?: string;
  additions?: number;
  deletions?: number;
  maxHeightClass?: string;
  linePick?: ReviewLinePickProps;
  statusLabel?: string;
  pending?: boolean;
  /** When false, hide the hover Open affordance. Defaults true when `filePath` is set. */
  openable?: boolean;
  /** Hide the blinking stream cursor on the partial tail line. */
  hideStreamCursor?: boolean;
  /** Brief crossfade when handoff from preview → FS-aware stream. */
  handoff?: boolean;
}

function countStats(hunks: DiffHunk[]): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.kind === '+') additions++;
      else if (line.kind === '-') deletions++;
    }
  }
  return { additions, deletions };
}

export function EditDiffView({
  hunks,
  variant,
  filePath = '',
  additions,
  deletions,
  maxHeightClass,
  linePick,
  statusLabel,
  pending,
  openable,
  hideStreamCursor,
  handoff
}: EditDiffViewProps) {
  const workspaceId = useWorkspaceStore((s) => s.activeId);

  if (linePick) {
    return (
      <DiffViewer
        hunks={hunks}
        variant={variant}
        showLayoutToggle={variant !== 'partial'}
        {...(maxHeightClass ? { maxHeightClass } : {})}
        linePick={linePick}
      />
    );
  }

  const stats = countStats(hunks);
  const add = additions ?? stats.additions;
  const del = deletions ?? stats.deletions;
  const canOpen = openable !== false && filePath.length > 0;
  const onOpen = canOpen
    ? () => {
        void openWorkspaceFile(filePath, {
          ...(workspaceId ? { workspaceId } : {}),
          context: 'edit-diff'
        });
      }
    : undefined;

  return (
    <FileChangeCard
      filePath={filePath || 'file'}
      additions={add}
      deletions={del}
      variant={variant}
      {...(pending !== undefined ? { pending } : {})}
      {...(statusLabel ? { statusLabel } : {})}
      {...(onOpen ? { onOpen } : {})}
    >
      <SnippetDiffBody
        hunks={hunks}
        variant={variant}
        {...(filePath ? { filePath } : {})}
        {...(maxHeightClass ? { maxHeightClass } : {})}
        {...(hideStreamCursor ? { hideStreamCursor } : {})}
        {...(handoff ? { handoff } : {})}
      />
    </FileChangeCard>
  );
}
