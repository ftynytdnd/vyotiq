/**
 * Lazy per-file git diff preview — stable cache with soft refresh on git changes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DiffHunk } from '@shared/types/tool.js';
import type { GitPathStatus } from '@shared/types/ipc.js';
import { vyotiq } from '../lib/ipc.js';
import { subscribeWorkspaceTreeChanged } from '../lib/workspaceTreeChangeHub.js';

export interface GitDiffPreviewRow {
  path: string;
  status: GitPathStatus;
  /** When set, diff against the index (staged) vs worktree (unstaged). */
  staged?: boolean;
}

export interface GitDiffPreviewState {
  hunks: DiffHunk[];
  loading: boolean;
  loaded: boolean;
  binary?: boolean;
  truncated?: boolean;
  error?: boolean;
}

const EMPTY_PREVIEW: GitDiffPreviewState = {
  hunks: [],
  loading: false,
  loaded: false
};

const MAX_CACHED_PREVIEWS = 48;
const TREE_INVALIDATE_DEBOUNCE_MS = 400;

function trimPreviewCache(
  prev: Record<string, GitDiffPreviewState>,
  key: string,
  entry: GitDiffPreviewState
): Record<string, GitDiffPreviewState> {
  const next = { ...prev, [key]: entry };
  const keys = Object.keys(next);
  if (keys.length <= MAX_CACHED_PREVIEWS) return next;
  const drop = keys.find((k) => k !== key);
  if (!drop) return next;
  const { [drop]: _removed, ...rest } = next;
  return rest;
}

export function previewKeyForRow(row: GitDiffPreviewRow): string {
  return `${row.staged ? 'staged' : 'worktree'}:${row.path}`;
}

function previewRowsEqual(a: GitDiffPreviewRow | null, b: GitDiffPreviewRow | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.path === b.path && a.status === b.status && Boolean(a.staged) === Boolean(b.staged);
}

export function useGitFileDiffPreview(
  workspaceId: string | null,
  selected: GitDiffPreviewRow | null
): GitDiffPreviewState | undefined {
  const [previewByKey, setPreviewByKey] = useState<Record<string, GitDiffPreviewState>>({});
  const loadGenerationRef = useRef(0);
  const selectedRef = useRef<GitDiffPreviewRow | null>(selected);
  const invalidateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  selectedRef.current = selected;

  const loadPreview = useCallback(
    async (row: GitDiffPreviewRow, generation: number, soft = false) => {
      if (!workspaceId) return;
      const key = previewKeyForRow(row);

      setPreviewByKey((prev) => {
        const existing = prev[key];
        if (soft && existing?.loaded) return prev;
        return {
          ...prev,
          [key]: {
            hunks: existing?.hunks ?? [],
            loading: !existing?.loaded,
            loaded: existing?.loaded ?? false,
            binary: existing?.binary,
            truncated: existing?.truncated,
            error: existing?.error
          }
        };
      });

      try {
        const result = await vyotiq.workspace.gitFileDiff({
          workspaceId,
          path: row.path,
          status: row.status,
          staged: row.staged
        });
        if (generation !== loadGenerationRef.current) return;
        if (!previewRowsEqual(selectedRef.current, row)) return;
        setPreviewByKey((prev) =>
          trimPreviewCache(prev, key, {
            hunks: result.hunks,
            loading: false,
            loaded: true,
            binary: result.binary,
            truncated: result.truncated
          })
        );
      } catch {
        if (generation !== loadGenerationRef.current) return;
        if (!previewRowsEqual(selectedRef.current, row)) return;
        setPreviewByKey((prev) => {
          const existing = prev[key];
          if (soft && existing?.loaded) return prev;
          return {
            ...prev,
            [key]: { hunks: [], loading: false, loaded: true, error: true }
          };
        });
      }
    },
    [workspaceId]
  );

  const scheduleSoftRefresh = useCallback(() => {
    if (invalidateTimerRef.current !== null) clearTimeout(invalidateTimerRef.current);
    invalidateTimerRef.current = setTimeout(() => {
      invalidateTimerRef.current = null;
      const row = selectedRef.current;
      if (!row || !workspaceId) return;
      const generation = loadGenerationRef.current;
      void loadPreview(row, generation, true);
    }, TREE_INVALIDATE_DEBOUNCE_MS);
  }, [workspaceId, loadPreview]);

  useEffect(() => {
    if (!workspaceId) return;
    return subscribeWorkspaceTreeChanged((payload) => {
      if (payload.workspaceId !== workspaceId) return;
      scheduleSoftRefresh();
    });
  }, [workspaceId, scheduleSoftRefresh]);

  useEffect(() => {
    setPreviewByKey({});
    loadGenerationRef.current += 1;
    if (invalidateTimerRef.current !== null) {
      clearTimeout(invalidateTimerRef.current);
      invalidateTimerRef.current = null;
    }
  }, [workspaceId]);

  useEffect(
    () => () => {
      if (invalidateTimerRef.current !== null) clearTimeout(invalidateTimerRef.current);
    },
    []
  );

  const selectedKey = selected ? previewKeyForRow(selected) : null;

  useEffect(() => {
    if (!selected || !workspaceId) return;
    const key = previewKeyForRow(selected);
    const existing = previewByKey[key];
    if (existing?.loaded || existing?.loading) return;
    const generation = loadGenerationRef.current;
    void loadPreview(selected, generation, false);
  }, [selectedKey, selected, workspaceId, previewByKey, loadPreview]);

  if (!selected) return undefined;
  return previewByKey[previewKeyForRow(selected)] ?? EMPTY_PREVIEW;
}

/** Stable preview row identity for hook consumers. */
export function useGitDiffPreviewRow(
  selected: { path: string; status: GitPathStatus; section: 'staged' | 'unstaged' } | null
): GitDiffPreviewRow | null {
  return useMemo(
    () =>
      selected
        ? {
            path: selected.path,
            status: selected.status,
            staged: selected.section === 'staged'
          }
        : null,
    [selected?.path, selected?.status, selected?.section]
  );
}
