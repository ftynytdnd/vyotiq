/**
 * Settings → Agent behavior → Checkpoints — review pending file changes.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PendingChange } from '@shared/types/checkpoint.js';
import type { DiffHunk } from '@shared/types/tool.js';
import { computeDiffHunks } from '@shared/text/diff/computeDiffHunks.js';
import { vyotiq } from '../../lib/ipc.js';
import { useActiveConversationId } from '../../store/useConversationsStore.js';
import { useToastStore } from '../../store/useToastStore.js';
import { ShellCaption, ShellRow, ShellSection, ShellStack } from '../ui/ShellSection.js';
import { Button } from '../ui/Button.js';
import { LoadingHint } from '../ui/LoadingHint.js';
import { SnippetDiffBody } from '../diff/SnippetDiffBody.js';
import { cn } from '../../lib/cn.js';

export function CheckpointsPanel() {
  const conversationId = useActiveConversationId();
  const [pending, setPending] = useState<PendingChange[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [previewById, setPreviewById] = useState<Record<string, { hunks: DiffHunk[]; loading: boolean }>>(
    {}
  );

  const refresh = useCallback(async () => {
    if (!conversationId) {
      setPending([]);
      return;
    }
    try {
      const rows = await vyotiq.checkpoints.listPending(conversationId);
      setPending(rows);
    } catch {
      setPending([]);
    }
  }, [conversationId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const unsub = vyotiq.checkpoints.onChanged(() => {
      void refresh();
    });
    return unsub;
  }, [refresh]);

  const loadPreview = useCallback(async (row: PendingChange) => {
    if (!row.preHash && !row.postHash) return;
    setPreviewById((prev) => ({
      ...prev,
      [row.entryId]: { hunks: prev[row.entryId]?.hunks ?? [], loading: true }
    }));
    try {
      const [pre, post] = await Promise.all([
        row.preHash
          ? vyotiq.checkpoints.readBlob(row.workspaceId, row.preHash)
          : Promise.resolve(''),
        row.postHash
          ? vyotiq.checkpoints.readBlob(row.workspaceId, row.postHash)
          : Promise.resolve('')
      ]);
      const hunks = computeDiffHunks(pre ?? '', post ?? '');
      setPreviewById((prev) => ({
        ...prev,
        [row.entryId]: { hunks, loading: false }
      }));
    } catch {
      setPreviewById((prev) => ({
        ...prev,
        [row.entryId]: { hunks: [], loading: false }
      }));
      useToastStore.getState().show('Could not load checkpoint diff preview.', 'danger');
    }
  }, []);

  const toggleExpand = useCallback(
    (row: PendingChange) => {
      if (expandedId === row.entryId) {
        setExpandedId(null);
        return;
      }
      setExpandedId(row.entryId);
      if (!previewById[row.entryId]?.hunks.length && !previewById[row.entryId]?.loading) {
        void loadPreview(row);
      }
    },
    [expandedId, loadPreview, previewById]
  );

  const acceptOne = async (entryId: string) => {
    setBusyId(entryId);
    try {
      await vyotiq.checkpoints.accept(entryId);
      await refresh();
      setExpandedId((id) => (id === entryId ? null : id));
    } finally {
      setBusyId(null);
    }
  };

  const rejectOne = async (entryId: string) => {
    setBusyId(entryId);
    try {
      await vyotiq.checkpoints.reject(entryId);
      await refresh();
      setExpandedId((id) => (id === entryId ? null : id));
    } finally {
      setBusyId(null);
    }
  };

  const acceptAllPending = async () => {
    if (!conversationId) return;
    setBusyId('all');
    try {
      await vyotiq.checkpoints.acceptAll(conversationId);
      await refresh();
      setExpandedId(null);
    } finally {
      setBusyId(null);
    }
  };

  const expandedPreview = useMemo(() => {
    if (!expandedId) return null;
    return previewById[expandedId] ?? null;
  }, [expandedId, previewById]);

  const expandedRow = pending.find((r) => r.entryId === expandedId);

  return (
    <ShellSection title="Checkpoints">
      <ShellStack>
        <ShellCaption>
          Review agent file edits before they settle. Reject restores the pre-change file on disk.
          Expand a row to preview the on-disk diff from checkpoint blobs.
        </ShellCaption>
        {!conversationId ? (
          <ShellCaption>No active conversation — open a chat to review pending changes.</ShellCaption>
        ) : pending.length === 0 ? (
          <ShellCaption>No pending file changes for this chat.</ShellCaption>
        ) : (
          <>
            <ShellRow>
              <Button
                variant="ghost"
                size="sm"
                disabled={busyId !== null}
                onClick={() => void acceptAllPending()}
              >
                Accept all ({pending.length})
              </Button>
            </ShellRow>
            {pending.map((row) => {
              const expanded = expandedId === row.entryId;
              return (
                <div
                  key={row.entryId}
                  className={cn(
                    'rounded-inner border border-border-subtle/40 bg-surface-sidebar/50 px-3 py-2'
                  )}
                >
                  <ShellRow className="flex-col items-stretch gap-2 sm:flex-row sm:items-center">
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left font-mono text-row text-text-secondary hover:text-text-primary"
                      onClick={() => toggleExpand(row)}
                    >
                      <span className="text-text-muted">{row.kind}</span>{' '}
                      <span className="truncate">{row.filePath}</span>
                      <span className="ml-2 text-meta text-text-faint">
                        +{row.additions}/−{row.deletions}
                      </span>
                    </button>
                    <div className="flex shrink-0 gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busyId !== null}
                        onClick={() => void acceptOne(row.entryId)}
                      >
                        Accept
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busyId !== null}
                        onClick={() => void rejectOne(row.entryId)}
                      >
                        Reject
                      </Button>
                    </div>
                  </ShellRow>
                  {expanded ? (
                    <div className="mt-2 border-t border-border-subtle/30 pt-2">
                      {expandedPreview?.loading ? (
                        <LoadingHint message="Loading diff…" className="py-2" />
                      ) : expandedPreview && expandedPreview.hunks.length > 0 ? (
                        <SnippetDiffBody
                          hunks={expandedPreview.hunks}
                          variant="preview"
                          filePath={expandedRow?.filePath}
                          maxHeightClass="max-h-48"
                        />
                      ) : (
                        <ShellCaption className="text-text-faint">
                          No blob diff available for this change.
                        </ShellCaption>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </>
        )}
      </ShellStack>
    </ShellSection>
  );
}
