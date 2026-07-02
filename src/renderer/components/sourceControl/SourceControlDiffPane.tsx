/**
 * Source control diff preview pane — file header + snippet diff or image preview.
 */

import { useEffect, useMemo, useState } from 'react';
import { FileDiff, FileImage, Minus, Plus } from 'lucide-react';
import type { SourceControlFileRow } from './sourceControlModel.js';
import type { GitDiffPreviewState } from '../../hooks/useGitFileDiffPreview.js';
import { SnippetDiffBody } from '../diff/SnippetDiffBody.js';
import { LoadingHint } from '../ui/LoadingHint.js';
import { FileIconForPath } from '../../lib/fileIconForPath.js';
import { SHELL_ROW_ICON_CLASS, SHELL_ROW_ICON_STROKE } from '../../lib/shellIcons.js';
import { SourceControlPathLabel } from './sourceControlPathLabel.js';
import { gitStatusAriaLabel, gitStatusBadgeCn } from '../../lib/dockGitTreeStyle.js';
import { isLikelyImagePath, looksLikeBinaryHunks } from './sourceControlDiffBinary.js';
import { cn } from '../../lib/cn.js';
import { vyotiq } from '../../lib/ipc.js';

function countHunkStats(hunks: GitDiffPreviewState['hunks']): { adds: number; dels: number } | null {
  if (!hunks?.length) return null;
  let adds = 0;
  let dels = 0;
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.kind === '+') adds++;
      else if (line.kind === '-') dels++;
    }
  }
  return adds > 0 || dels > 0 ? { adds, dels } : null;
}

interface SourceControlDiffPaneProps {
  workspaceId: string | null;
  selected: SourceControlFileRow | null;
  preview: GitDiffPreviewState | undefined;
  onOpenInEditor: () => void;
  onStage?: () => void;
  onUnstage?: () => void;
  compact?: boolean;
  className?: string;
}

export function SourceControlDiffPane({
  workspaceId,
  selected,
  preview,
  onOpenInEditor,
  onStage,
  onUnstage,
  compact = false,
  className
}: SourceControlDiffPaneProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  const treatAsBinary = useMemo(() => {
    if (!preview || !selected) return false;
    if (preview.binary) return true;
    if (preview.hunks.length > 0 && looksLikeBinaryHunks(preview.hunks)) return true;
    if (isLikelyImagePath(selected.path) && (selected.status === 'A' || selected.status === '?')) {
      return true;
    }
    return false;
  }, [preview, selected]);

  const stats = useMemo(() => {
    if (!preview?.hunks?.length || treatAsBinary) return null;
    return countHunkStats(preview.hunks);
  }, [preview?.hunks, treatAsBinary]);

  useEffect(() => {
    setImageUrl(null);
    if (!workspaceId || !selected || !treatAsBinary || !isLikelyImagePath(selected.path)) return;
    let cancelled = false;
    void vyotiq.attachments
      .fileUrl({ workspaceId, path: selected.path })
      .then((url) => {
        if (!cancelled) setImageUrl(url);
      })
      .catch(() => {
        if (!cancelled) setImageUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, selected, treatAsBinary]);

  if (!selected) {
    return (
      <div
        className={cn(
          'vx-sc-diff-pane vx-sc-diff-empty',
          compact && 'vx-sc-diff-pane--compact',
          className
        )}
      >
        <FileDiff className="size-6 text-text-faint" strokeWidth={1.5} aria-hidden />
        <p className="vx-sc-diff-empty-hint">Select a file to preview changes.</p>
      </div>
    );
  }

  const sectionLabel = selected.section === 'staged' ? 'Staged' : 'Unstaged';

  return (
    <div className={cn('vx-sc-diff-pane', compact && 'vx-sc-diff-pane--compact', className)}>
      <header className="vx-sc-diff-head">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <FileIconForPath filePath={selected.path} />
            <span
              className={cn(gitStatusBadgeCn(selected.status), 'vx-sc-status-badge shrink-0')}
              aria-label={gitStatusAriaLabel(selected.status)}
            >
              {selected.status}
            </span>
            <span className="vx-sc-diff-section-pill">{sectionLabel}</span>
            {stats ? (
              <span className="vx-sc-diff-stats">
                {stats.adds > 0 ? <span className="vx-sc-diff-stat-add">+{stats.adds}</span> : null}
                {stats.dels > 0 ? <span className="vx-sc-diff-stat-del">−{stats.dels}</span> : null}
              </span>
            ) : null}
          </div>
          <SourceControlPathLabel
            path={selected.path}
            status={selected.status}
            variant="full"
            className="mt-1"
          />
        </div>
        <div className="vx-sc-diff-head-actions">
          {selected.section === 'unstaged' && onStage ? (
            <button type="button" className="vx-sc-diff-action" onClick={onStage} title="Stage">
              <Plus className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} />
            </button>
          ) : null}
          {selected.section === 'staged' && onUnstage ? (
            <button type="button" className="vx-sc-diff-action" onClick={onUnstage} title="Unstage">
              <Minus className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} />
            </button>
          ) : null}
          {selected.status !== 'D' ? (
            <button
              type="button"
              className="vx-sc-diff-open-btn"
              onClick={onOpenInEditor}
              title="Open in editor"
            >
              Open
            </button>
          ) : null}
        </div>
      </header>

      <div className="vx-sc-diff-body scrollbar-stealth">
        {preview?.loading && !preview.loaded ? (
          <LoadingHint message="Loading…" className="py-8" />
        ) : treatAsBinary ? (
          imageUrl ? (
            <div className="vx-sc-diff-image-wrap">
              <img src={imageUrl} alt={selected.path} className="vx-sc-diff-image" />
            </div>
          ) : (
            <div className="vx-sc-diff-placeholder">
              <FileImage className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} aria-hidden />
              Binary file — use Open to inspect.
            </div>
          )
        ) : preview?.error ? (
          <div className="vx-sc-diff-placeholder text-text-faint">Could not load diff.</div>
        ) : preview && preview.hunks.length > 0 ? (
          <>
            {preview.truncated ? (
              <p className="vx-sc-diff-truncated">Preview truncated to first 512 KB.</p>
            ) : null}
            <SnippetDiffBody
              hunks={preview.hunks}
              variant="authoritative"
              filePath={selected.path}
              maxHeightClass={compact ? 'max-h-48' : 'max-h-none'}
            />
          </>
        ) : (
          <div className="vx-sc-diff-placeholder text-text-faint">
            {selected.status === '?' ? 'New untracked file.' : 'No textual diff.'}
          </div>
        )}
      </div>
    </div>
  );
}
