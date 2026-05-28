/**
 * Unified diff surface — blob loading and hunk resolution for checkpoints,
 * timeline file edits, and edit approval. Rendering delegates to the shared
 * `DiffViewer` (unified / split toggle).
 */

import { useEffect, useMemo, useState } from 'react';
import type { DiffHunk } from '@shared/types/tool.js';
import type { CheckpointChangeKind } from '@shared/types/checkpoint.js';
import { useCheckpointsStore } from '../../store/useCheckpointsStore.js';
import { CodeBlock } from '../timeline/tools/shared/CodeBlock.js';
import { synthesizeCreateHunks } from '../timeline/tools/edit/synthesizeDiffPreview.js';
import { computeDiffHunksClient } from '../checkpoints/diffClient.js';
import { chromeInsetNoteClassName } from '../ui/SurfaceShell.js';
import type { DiffViewVariant } from '../timeline/tools/edit/diff/DiffHunk.js';
import type { ReviewLinePickProps } from '../timeline/tools/edit/diff/diffLinePick.js';
import { DiffViewer } from './DiffViewer.js';

interface UnifiedDiffPanelProps {
  /** Precomputed hunks — skips blob loading when provided. */
  hunks?: DiffHunk[];
  workspaceId?: string;
  kind?: CheckpointChangeKind;
  preHash?: string;
  postHash?: string;
  /** Inline bodies for approval dialog when hashes are absent. */
  preBody?: string;
  postBody?: string;
  variant?: DiffViewVariant;
  maxHeightClass?: string;
  linePick?: ReviewLinePickProps;
  /** Hide the layout toggle (e.g. streaming partial diffs). */
  showLayoutToggle?: boolean;
}

interface BlobsState {
  pre: string | null;
  post: string | null;
  loaded: boolean;
}

export function UnifiedDiffPanel({
  hunks: hunksProp,
  workspaceId,
  kind,
  preHash,
  postHash,
  preBody,
  postBody,
  variant = 'authoritative',
  maxHeightClass,
  linePick,
  showLayoutToggle = true
}: UnifiedDiffPanelProps) {
  const readBlob = useCheckpointsStore((s) => s.readBlob);
  const [blobs, setBlobs] = useState<BlobsState>({ pre: null, post: null, loaded: !workspaceId });

  useEffect(() => {
    if (hunksProp || !workspaceId || !kind) {
      setBlobs({ pre: null, post: null, loaded: true });
      return;
    }
    let cancelled = false;
    setBlobs({ pre: null, post: null, loaded: false });
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
  }, [hunksProp, workspaceId, kind, preHash, postHash, readBlob]);

  const resolved = useMemo(() => {
    if (hunksProp && hunksProp.length > 0) {
      return { mode: 'hunks' as const, hunks: hunksProp };
    }
    if (kind === 'create') {
      if (workspaceId && !blobs.loaded) {
        return { mode: 'loading' as const };
      }
      if (blobs.loaded && postHash && blobs.post == null) {
        return { mode: 'missing' as const, which: 'post' as const };
      }
      const body = blobs.post ?? postBody ?? '';
      return { mode: 'hunks' as const, hunks: synthesizeCreateHunks(body) };
    }
    if (kind === 'delete') {
      const body = blobs.pre ?? preBody ?? '';
      return { mode: 'delete' as const, body };
    }
    if (kind === 'modify') {
      if (workspaceId && !blobs.loaded) {
        return { mode: 'loading' as const };
      }
      const pre = blobs.pre ?? preBody;
      const post = blobs.post ?? postBody;
      if (preHash && blobs.loaded && blobs.pre === null) {
        return { mode: 'missing' as const, which: 'pre' as const };
      }
      if (postHash && blobs.loaded && blobs.post === null) {
        return { mode: 'missing' as const, which: 'post' as const };
      }
      if (typeof pre === 'string' && typeof post === 'string') {
        const hunks = computeDiffHunksClient(pre, post);
        return hunks.length > 0
          ? { mode: 'hunks' as const, hunks }
          : { mode: 'empty' as const };
      }
      return { mode: 'loading' as const };
    }
    if (hunksProp) {
      return hunksProp.length > 0
        ? { mode: 'hunks' as const, hunks: hunksProp }
        : { mode: 'empty' as const };
    }
    return { mode: 'empty' as const };
  }, [hunksProp, kind, workspaceId, preHash, postHash, blobs.loaded, blobs.pre, blobs.post, preBody, postBody]);

  if (resolved.mode === 'loading') {
    return (
      <div className={chromeInsetNoteClassName}>
        Loading diff…
      </div>
    );
  }

  if (resolved.mode === 'missing') {
    const label =
      resolved.which === 'post'
        ? 'Snapshot missing — the post-state blob is no longer in the checkpoint store.'
        : 'Snapshot missing — the pre-state blob is no longer in the checkpoint store.';
    return <div className={chromeInsetNoteClassName}>{label}</div>;
  }

  if (resolved.mode === 'delete') {
    return <CodeBlock body={resolved.body} tone="danger" />;
  }

  if (resolved.mode === 'empty') {
    return (
      <div className={chromeInsetNoteClassName}>
        No textual changes.
      </div>
    );
  }

  if (resolved.mode !== 'hunks' || !resolved.hunks) {
    return (
      <div className={chromeInsetNoteClassName}>
        No textual changes.
      </div>
    );
  }

  return (
    <DiffViewer
      hunks={resolved.hunks}
      variant={variant}
      showLayoutToggle={showLayoutToggle}
      {...(maxHeightClass ? { maxHeightClass } : {})}
      {...(linePick ? { linePick } : {})}
    />
  );
}
