/**
 * Renders a checkpoint entry's diff. Reuses the existing
 * `EditDiffView` so the visual rhythm matches the timeline
 * `EditInvocation`.
 *
 * Three modes:
 *   - `modify`: read both `preHash` and `postHash` blobs and compute
 *     hunks via `computeDiffHunksClient` (a thin wrapper that
 *     re-exports the shared `@shared/text/diff/computeDiffHunks`
 *     module — same algorithm the main-side `edit` tool uses).
 *   - `create`: render the post body as an all-`+` hunk through
 *     `EditDiffView` (variant `authoritative`). Same rendering the
 *     timeline `EditInvocation` settled-create branch uses — every
 *     line carries the `+` marker and green tint, so a new file
 *     reads as a diff rather than a muted plain-text wall. Pre-fix
 *     this branch fell back to `CodeBlock tone="muted"` which is
 *     what the user was seeing when they said "what the fuck is
 *     wrong with these diffs?" in the pending-changes screenshot.
 *   - `delete`: render the pre body in danger tone (`CodeBlock`)
 *     with a `Deleted file` label. The delete invocation in the
 *     timeline carries the FS-aware live diff with `-` lines; the
 *     settled pending-changes view stays minimal because the
 *     authoritative `deletedLines` count + revert affordance is
 *     all the user needs here.
 *
 * Phase 1.4: the previous version embedded a `unified | side-by-side`
 * toggle plus a `vyotiq.checkpoints.diffView` localStorage pref. The
 * user-flow pass made unified the canonical mode everywhere — the
 * timeline column is too narrow for side-by-side and dual-pane diffs
 * fragmented the visual rhythm between Checkpoints and the
 * timeline. The toggle and its localStorage entry are gone; this
 * file now mirrors the timeline `EditInvocation` shape exactly.
 */

import { useEffect, useMemo, useState } from 'react';
import type { DiffHunk } from '@shared/types/tool.js';
import type { CheckpointChangeKind } from '@shared/types/checkpoint.js';
import { useCheckpointsStore } from '../../store/useCheckpointsStore.js';
import { EditDiffView } from '../timeline/tools/edit/EditDiffView.js';
import { CodeBlock } from '../timeline/tools/shared/CodeBlock.js';
import { synthesizeCreateHunks } from '../timeline/tools/edit/synthesizeDiffPreview.js';
import { computeDiffHunksClient } from './diffClient.js';

interface PendingChangeDiffProps {
  workspaceId: string;
  kind: CheckpointChangeKind;
  preHash?: string;
  postHash?: string;
}

interface BlobsState {
  pre: string | null;
  post: string | null;
  loaded: boolean;
}

export function PendingChangeDiff({
  workspaceId,
  kind,
  preHash,
  postHash
}: PendingChangeDiffProps) {
  const readBlob = useCheckpointsStore((s) => s.readBlob);
  const [blobs, setBlobs] = useState<BlobsState>({ pre: null, post: null, loaded: false });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const [pre, post] = await Promise.all([
        preHash ? readBlob(workspaceId, preHash) : Promise.resolve(null),
        postHash ? readBlob(workspaceId, postHash) : Promise.resolve(null)
      ]);
      if (cancelled) return;
      setBlobs({ pre, post, loaded: true });
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, preHash, postHash, readBlob]);

  const hunks = useMemo<DiffHunk[]>(() => {
    if (kind !== 'modify') return [];
    if (blobs.pre === null || blobs.post === null) return [];
    return computeDiffHunksClient(blobs.pre, blobs.post);
  }, [kind, blobs.pre, blobs.post]);

  if (!blobs.loaded) {
    return (
      <div className="rounded-inner bg-surface-overlay px-3 py-2 text-row text-text-faint">
        Loading diff…
      </div>
    );
  }

  if (kind === 'create') {
    if (blobs.post === null) {
      return (
        <div className="rounded-inner bg-surface-overlay px-3 py-2 text-row text-text-faint">
          Snapshot missing — the post-state blob is no longer in the checkpoint store.
        </div>
      );
    }
    // Render the new file as an all-`+` hunk via the shared
    // `EditDiffView`. Mirrors the timeline `EditInvocation`
    // settled-create branch so the pending-changes panel and the
    // timeline read identically for the same change. Empty-file
    // creates (zero-byte snapshot) still produce a single empty
    // `+` line which `EditDiffView` renders as a blank green row
    // — better than no signal at all.
    return (
      <EditDiffView
        key="pending-create"
        hunks={synthesizeCreateHunks(blobs.post)}
        variant="authoritative"
      />
    );
  }

  if (kind === 'delete') {
    if (blobs.pre === null) {
      return (
        <div className="rounded-inner bg-surface-overlay px-3 py-2 text-row text-text-faint">
          Snapshot missing — the pre-state blob is no longer in the checkpoint store.
        </div>
      );
    }
    return <CodeBlock body={blobs.pre} tone="danger" />;
  }

  // modify
  if (hunks.length === 0) {
    return (
      <div className="rounded-inner bg-surface-overlay px-3 py-2 text-row text-text-faint">
        No textual changes.
      </div>
    );
  }
  return <EditDiffView hunks={hunks} variant="authoritative" />;
}
