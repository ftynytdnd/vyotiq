/**
 * PR-style review slice 1–2 — per-file comments, git base ref, decisions.
 *
 * Approve / Request changes auto-accept pending only when the workspace
 * setting `approveAutoAcceptPendingByWorkspace` is on (default off).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type {
  GitRefOption,
  ReviewDecision,
  ReviewSession
} from '@shared/types/checkpoint.js';
import { vyotiq } from '../../../lib/ipc.js';
import {
  reviewCacheKey,
  useCheckpointsStore
} from '../../../store/useCheckpointsStore.js';
import { usePendingChangeBulkActions } from '../shared/usePendingChangeActions.js';
import { useSettingsStore } from '../../../store/useSettingsStore.js';
import { useToastStore } from '../../../store/useToastStore.js';
import { Button } from '../../ui/Button.js';
import { Dropdown } from '../../ui/Dropdown.js';
import { TextField } from '../../ui/TextField.js';
import { chromeInsetNoteClassName } from '../../ui/SurfaceShell.js';
import { parseUnifiedPatch } from '@shared/text/diff/parseUnifiedPatch.js';
import { cn } from '../../../lib/cn.js';
import { CodeBlock } from '../../timeline/tools/shared/CodeBlock.js';
import { EditDiffView } from '../../timeline/tools/edit/EditDiffView.js';

interface ReviewSessionPanelProps {
  workspaceId: string;
  conversationId: string;
  runId?: string;
  filePath: string;
  /** Synced with diff line clicks in review mode. */
  commentLine?: number | null;
  onCommentLineChange?: (line: number | null) => void;
}

export function ReviewSessionPanel({
  workspaceId,
  conversationId,
  runId,
  filePath,
  commentLine = null,
  onCommentLineChange
}: ReviewSessionPanelProps) {
  const cachedSession = useCheckpointsStore(
    (s) => s.reviewByConversation[reviewCacheKey(workspaceId, conversationId)] ?? null
  );
  const [session, setSession] = useState<ReviewSession | null>(cachedSession);
  const [draft, setDraft] = useState('');
  const [lineDraft, setLineDraft] = useState('');
  const [gitRefDraft, setGitRefDraft] = useState('HEAD');
  const [busy, setBusy] = useState(false);
  const [gitOn, setGitOn] = useState(false);
  const [gitPatch, setGitPatch] = useState<string | null>(null);
  const [gitNote, setGitNote] = useState<string | null>(null);
  const [gitRefOptions, setGitRefOptions] = useState<GitRefOption[]>([]);
  const [reviewerDraft, setReviewerDraft] = useState('');
  const [restorePendingOnImport, setRestorePendingOnImport] = useState(false);

  const approveAutoAccept =
    useSettingsStore(
      (s) => s.settings.ui?.approveAutoAcceptPendingByWorkspace?.[workspaceId] === true
    );
  const pendingForFile = useCheckpointsStore(
    useShallow((s) =>
      (s.pendingByConversation[conversationId] ?? []).filter((p) => p.filePath === filePath)
    )
  );
  const importReview = useCheckpointsStore((s) => s.importReview);
  const showToast = useToastStore((s) => s.show);

  const effectiveGitRef = session?.gitBaseRef?.trim() || gitRefDraft.trim() || 'HEAD';

  const reload = useCallback(async (): Promise<ReviewSession | null> => {
    const s =
      (await vyotiq.checkpoints.getReview(workspaceId, conversationId)) ??
      (await vyotiq.checkpoints.ensureReview({
        workspaceId,
        conversationId,
        ...(runId ? { runId } : {})
      }));
    setSession(s);
    if (s.gitBaseRef) setGitRefDraft(s.gitBaseRef);
    if (s.reviewerLabel) setReviewerDraft(s.reviewerLabel);
    return s;
  }, [workspaceId, conversationId, runId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const s =
        (await vyotiq.checkpoints.getReview(workspaceId, conversationId)) ??
        (await vyotiq.checkpoints.ensureReview({
          workspaceId,
          conversationId,
          ...(runId ? { runId } : {})
        }));
      if (cancelled) return;
      setSession(s);
      if (s.gitBaseRef) setGitRefDraft(s.gitBaseRef);
      if (s.reviewerLabel) setReviewerDraft(s.reviewerLabel);
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, conversationId, runId]);

  useEffect(() => {
    if (cachedSession) setSession(cachedSession);
  }, [cachedSession]);

  useEffect(() => {
    void useCheckpointsStore.getState().refreshReview(conversationId, workspaceId);
  }, [conversationId, workspaceId]);

  useEffect(() => {
    let cancelled = false;
    void vyotiq.checkpoints.listGitRefs(workspaceId).then((result) => {
      if (cancelled || !result.ok) return;
      setGitRefOptions(result.options);
    });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  useEffect(() => {
    if (commentLine !== null && commentLine > 0) {
      setLineDraft(String(commentLine));
    }
  }, [commentLine]);

  useEffect(() => {
    if (!gitOn) {
      setGitPatch(null);
      setGitNote(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const result = await vyotiq.checkpoints.gitBaseDiff(
        workspaceId,
        filePath,
        effectiveGitRef
      );
      if (cancelled) return;
      if (result.ok) {
        setGitPatch(result.patch);
        setGitNote(`vs ${result.ref}`);
      } else {
        setGitPatch(null);
        setGitNote(
          result.reason === 'not-a-repo'
            ? 'Not a git repository'
            : result.reason === 'empty'
              ? 'No diff vs base'
              : result.message ?? result.reason
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gitOn, workspaceId, filePath, effectiveGitRef]);

  const fileComments = useMemo(
    () => (session?.comments ?? []).filter((c) => c.filePath === filePath),
    [session?.comments, filePath]
  );

  const gitHunks = useMemo(
    () => (gitPatch ? parseUnifiedPatch(gitPatch) : []),
    [gitPatch]
  );

  const gitLinePick =
    onCommentLineChange !== undefined
      ? {
          highlightLine: commentLine ?? null,
          onPick: (line: number) => onCommentLineChange(line)
        }
      : undefined;

  const persistReviewer = async () => {
    setBusy(true);
    try {
      const next = await vyotiq.checkpoints.setReviewReviewer({
        workspaceId,
        conversationId,
        reviewerLabel: reviewerDraft
      });
      setSession(next);
      void useCheckpointsStore.getState().refreshReview(conversationId, workspaceId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Could not save reviewer: ${msg}`, 'danger');
    } finally {
      setBusy(false);
    }
  };

  const onImport = async () => {
    setBusy(true);
    try {
      const result = await importReview(workspaceId, conversationId, undefined, {
        restorePending: restorePendingOnImport
      });
      if (!result) return;
      const { session: imported, applied, pendingRestore } = result;
      setSession(imported);
      if (imported.gitBaseRef) setGitRefDraft(imported.gitBaseRef);
      if (imported.reviewerLabel) setReviewerDraft(imported.reviewerLabel);
      const pendingNote =
        pendingRestore && restorePendingOnImport
          ? ` Pending: ${pendingRestore.restored} restored, ${pendingRestore.skipped} skipped (duplicate entryId kept local).`
          : '';
      showToast(
        (applied === 'merge' ? 'Review merged with existing metadata' : 'Review imported') +
          pendingNote,
        'success'
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Import failed: ${msg}`, 'danger');
    } finally {
      setBusy(false);
    }
  };

  const onExport = async () => {
    setBusy(true);
    try {
      const result = await vyotiq.checkpoints.exportReview({
        workspaceId,
        conversationId
      });
      showToast(`Review exported to ${result.exportPath}`, 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Export failed: ${msg}`, 'danger');
    } finally {
      setBusy(false);
    }
  };

  const persistGitRef = async () => {
    const ref = gitRefDraft.trim();
    if (!ref) return;
    setBusy(true);
    try {
      const next = await vyotiq.checkpoints.setReviewGitBaseRef({
        workspaceId,
        conversationId,
        ref
      });
      setSession(next);
      setGitRefDraft(next.gitBaseRef ?? ref);
    } catch {
      showToast('Invalid or unsupported git ref', 'danger');
    } finally {
      setBusy(false);
    }
  };

  const parseLine = (): number | undefined => {
    const raw = lineDraft.trim();
    if (!raw) return undefined;
    const n = Number.parseInt(raw, 10);
    if (!Number.isInteger(n) || n < 1) return undefined;
    return n;
  };

  const addComment = async () => {
    if (!draft.trim()) return;
    const line = parseLine();
    if (lineDraft.trim() && line === undefined) {
      showToast('Line must be a positive integer', 'danger');
      return;
    }
    setBusy(true);
    try {
      await vyotiq.checkpoints.addReviewComment({
        workspaceId,
        conversationId,
        filePath,
        body: draft,
        ...(line !== undefined ? { line } : {})
      });
      setDraft('');
      setLineDraft('');
      onCommentLineChange?.(null);
      await reload();
      void useCheckpointsStore.getState().refreshReview(conversationId, workspaceId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Could not save comment: ${msg}`, 'danger');
    } finally {
      setBusy(false);
    }
  };

  const { onAcceptAll: acceptAllPendingForFile } = usePendingChangeBulkActions(pendingForFile);

  const acceptPendingForFile = async () => {
    if (pendingForFile.length === 0) return;
    await acceptAllPendingForFile();
  };

  const setDecision = async (decision: ReviewDecision) => {
    setBusy(true);
    try {
      const next = await vyotiq.checkpoints.setReviewDecision({
        workspaceId,
        conversationId,
        decision,
        filePath
      });
      setSession(next);
      void useCheckpointsStore.getState().refreshReview(conversationId, workspaceId);
      if (decision === 'approve' && approveAutoAccept) {
        await acceptPendingForFile();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Could not save review decision: ${msg}`, 'danger');
    } finally {
      setBusy(false);
    }
  };

  const overall = session?.fileDecisions?.[filePath] ?? session?.decision;

  return (
    <div className="flex flex-col gap-2 border-t border-border-subtle/30 pt-3">
      <p className={cn(chromeInsetNoteClassName, 'text-meta text-text-muted')}>
        Review metadata is saved locally. It does not merge to git
        {approveAutoAccept
          ? '; Approve also accepts pending rows for this file when enabled in checkpoint settings.'
          : ' or auto-accept pending edits — use Accept/Reject below for file governance.'}
        {restorePendingOnImport &&
          ' Import will merge exported pending rows; rows with the same entryId as local pending are skipped.'}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-[8rem] flex-col gap-0.5 text-meta text-text-secondary">
          Reviewer
          <TextField
            value={reviewerDraft}
            onChange={(e) => setReviewerDraft(e.target.value)}
            onBlur={() => void persistReviewer()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void persistReviewer();
              }
            }}
            size="sm"
            disabled={busy}
            placeholder="Your name"
            aria-label="Reviewer name"
          />
        </label>
        {gitRefOptions.length > 0 ? (
          <label className="flex min-w-[10rem] flex-1 flex-col gap-0.5 text-meta text-text-secondary">
            Git base ref
            <Dropdown
              items={gitRefOptions.map((o) => ({
                value: o.ref,
                label: o.ref,
                group:
                  o.group === 'builtin' ? 'Common' : o.group === 'local' ? 'Local' : 'Remote'
              }))}
              value={gitRefDraft}
              onChange={(ref) => {
                setGitRefDraft(ref);
                void vyotiq.checkpoints
                  .setReviewGitBaseRef({ workspaceId, conversationId, ref })
                  .then(setSession)
                  .catch(() => showToast('Invalid git ref', 'danger'));
              }}
              disabled={busy}
              placeholder="Select ref…"
            />
          </label>
        ) : (
          <label className="flex min-w-[8rem] flex-1 flex-col gap-0.5 text-meta text-text-secondary">
            Git base ref
            <TextField
              value={gitRefDraft}
              onChange={(e) => setGitRefDraft(e.target.value)}
              onBlur={() => void persistGitRef()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void persistGitRef();
                }
              }}
              size="sm"
              disabled={busy}
              aria-label="Git base ref"
            />
          </label>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex items-center gap-1.5 text-meta text-text-secondary">
          <input
            type="checkbox"
            checked={gitOn}
            onChange={(e) => setGitOn(e.target.checked)}
            className="rounded-inner"
          />
          Compare to git base
        </label>
        {overall && (
          <span className="rounded-inner bg-surface-raised px-2 py-0.5 text-meta text-text-muted">
            {overall.replace('_', ' ')}
          </span>
        )}
        <label className="inline-flex items-center gap-1.5 text-meta text-text-secondary">
          <input
            type="checkbox"
            checked={restorePendingOnImport}
            onChange={(e) => setRestorePendingOnImport(e.target.checked)}
            className="rounded-inner"
          />
          Restore pending from export
        </label>
        <div className="ml-auto flex flex-wrap gap-1">
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void onImport()}>
            Import review
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void onExport()}>
            Export review
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void setDecision('request_changes')}
          >
            Request changes
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={busy}
            onClick={() => void setDecision('approve')}
          >
            Approve
          </Button>
        </div>
      </div>
      {gitOn && (
        <div className="overflow-hidden rounded-inner border border-border-subtle/40">
          {gitNote && !gitPatch && (
            <div className={cn(chromeInsetNoteClassName, 'text-meta text-text-faint')}>{gitNote}</div>
          )}
          {gitPatch && (
            <>
              {gitNote && (
                <div className="border-b border-border-subtle/30 px-2 py-1 text-meta text-text-faint">
                  {gitNote}
                  {gitHunks.length > 0 && onCommentLineChange && (
                    <span className="text-text-faint/80"> · click a line to anchor</span>
                  )}
                </div>
              )}
              {gitHunks.length > 0 ? (
                <EditDiffView
                  hunks={gitHunks}
                  variant="authoritative"
                  maxHeightClass="max-h-48"
                  {...(gitLinePick ? { linePick: gitLinePick } : {})}
                />
              ) : (
                <CodeBlock body={gitPatch} tone="muted" maxHeight={192} />
              )}
            </>
          )}
        </div>
      )}
      {fileComments.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {fileComments.map((c) => (
            <li
              key={c.id}
              className={cn(chromeInsetNoteClassName, 'text-meta text-text-secondary')}
            >
              {c.line !== undefined && (
                <span className="mr-1.5 font-mono text-text-faint">L{c.line}</span>
              )}
              {c.body}
            </li>
          ))}
        </ul>
      )}
      <p className={cn(chromeInsetNoteClassName, 'text-meta text-text-faint')}>
        Click a line in the diff above to anchor a comment, or enter a line number.
      </p>
      <div className="flex flex-wrap gap-2">
        <TextField
          value={lineDraft}
          onChange={(e) => {
            const v = e.target.value;
            setLineDraft(v);
            if (!onCommentLineChange) return;
            const n = Number.parseInt(v.trim(), 10);
            onCommentLineChange(Number.isInteger(n) && n > 0 ? n : null);
          }}
          placeholder="Line #"
          size="sm"
          className="w-20 shrink-0"
          aria-label="Comment line number"
        />
        <TextField
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a review comment for this file…"
          size="sm"
          className="min-w-0 flex-1"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void addComment();
            }
          }}
        />
        <Button size="sm" variant="ghost" disabled={busy || !draft.trim()} onClick={() => void addComment()}>
          Comment
        </Button>
      </div>
    </div>
  );
}
