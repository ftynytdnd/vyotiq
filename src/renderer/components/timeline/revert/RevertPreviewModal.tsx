/**
 * RevertPreviewModal — confirmation modal for the inline-on-prompt
 * Revert and Edit & resend actions.
 *
 * Lifecycle:
 *   1. The timeline's `UserPromptRow` Revert / Edit button calls into
 *      the `useRevertPrompt` context with the prompt's id (and, for
 *      edit, its content); that flips this modal open with the
 *      matching props.
 *   2. On open we fire `previewRewind` to enumerate every file that
 *      would be reverted and the count of transcript events that
 *      would be removed.
 *   3. The user reviews the impact, optionally expands per-file diffs
 *      via `RevertFileRow`, and clicks the primary action.
 *   4a. **Revert intent** — the matching `rewindToPrompt` IPC fires;
 *       the conversation transcript is rewound and the FS is rolled
 *       back atomically. Toast surfaces the outcome.
 *   4b. **Edit intent** — same rewind first; then the modal dispatches
 *       the edited text as a fresh `chat.send` so the new turn lands
 *       at the SAME conversation position the original occupied.
 *
 * Keep this modal fully read-only by default — destructive actions
 * fire only when the user explicitly clicks the primary button at
 * the bottom.
 */

import { useEffect, useMemo, useRef, useState, forwardRef } from 'react';
import {
  AlertTriangle,
  FileWarning,
  History,
  MessageSquare,
  Pencil,
  Undo2
} from 'lucide-react';
import type {
  RewindPreview,
  RewindPreviewResult
} from '@shared/types/checkpoint.js';
import type { ModelSelection } from '@shared/types/provider.js';
import { Modal } from '../../ui/Modal.js';
import { Button } from '../../ui/Button.js';
import { useCheckpointsStore } from '../../../store/useCheckpointsStore.js';
import { useToastStore } from '../../../store/useToastStore.js';
import { useChatStore } from '../../../store/useChatStore.js';
import {
  useSettingsStore,
  selectEffectivePermissions
} from '../../../store/useSettingsStore.js';
import { RevertFileRow } from './RevertFileRow.js';
import type { RevertIntent } from './RevertPromptContext.js';
import { cn } from '../../../lib/cn.js';

interface RevertPreviewModalProps {
  open: boolean;
  conversationId: string | null;
  workspaceId: string | null;
  promptEventId: string | null;
  /**
   * Pure rewind, or rewind + dispatch an edited prompt. Defaults to
   * `{ kind: 'revert' }` so isolated mounts (the original
   * `RevertPreviewModal.test.tsx` fixtures) keep working without
   * having to thread the new field through every call site.
   */
  intent?: RevertIntent;
  /** Active model selection — required for edit-and-resend. */
  model?: ModelSelection | null;
  onClose: () => void;
}

type ModalPhase =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; preview: RewindPreview }
  | { kind: 'error'; message: string }
  | { kind: 'reverting' }
  | { kind: 'sending' };

const EDIT_TEXTAREA_MAX_HEIGHT = 240;

export function RevertPreviewModal({
  open,
  conversationId,
  workspaceId,
  promptEventId,
  intent = { kind: 'revert' },
  model,
  onClose
}: RevertPreviewModalProps) {
  const previewRewind = useCheckpointsStore((s) => s.previewRewind);
  const rewindToPrompt = useCheckpointsStore((s) => s.rewindToPrompt);
  const showToast = useToastStore((s) => s.show);
  const send = useChatStore((s) => s.send);
  const settings = useSettingsStore((s) => s.settings);

  const [phase, setPhase] = useState<ModalPhase>({ kind: 'idle' });

  // Editable buffer for `edit` intent. Seeded from the original
  // prompt content the moment the modal opens; user-typed mutations
  // override it for the rest of the modal's lifetime. Reset on close.
  const initialEditContent =
    intent.kind === 'edit' ? intent.originalContent : '';
  const [editText, setEditText] = useState(initialEditContent);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Reset the editable buffer whenever the modal opens against a new
  // (prompt, intent) pair so a previously-edited draft from a prior
  // open doesn't leak into a fresh open. The dependency list pins to
  // the same identity tuple the preview effect uses.
  useEffect(() => {
    if (!open) return;
    setEditText(initialEditContent);
  }, [open, promptEventId, intent.kind, initialEditContent]);

  // Auto-size the textarea to its content (capped) so the modal feels
  // calm for short edits and doesn't paginate awkwardly for long ones.
  useEffect(() => {
    if (intent.kind !== 'edit') return;
    const el = editTextareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, EDIT_TEXTAREA_MAX_HEIGHT) + 'px';
  }, [editText, intent.kind, phase.kind]);

  // Fire the preview IPC every time the modal opens against a fresh
  // (conversation, prompt) pair. The dependency list intentionally
  // includes `open` so re-opening the same modal after a previous
  // close re-fetches in case the user accepted/rejected changes in
  // the meantime.
  useEffect(() => {
    if (!open) {
      setPhase({ kind: 'idle' });
      return;
    }
    if (!conversationId || !workspaceId || !promptEventId) {
      setPhase({
        kind: 'error',
        message: 'Missing conversation or workspace context.'
      });
      return;
    }
    let cancelled = false;
    setPhase({ kind: 'loading' });
    void (async () => {
      const result: RewindPreviewResult = await previewRewind({
        conversationId,
        workspaceId,
        promptEventId
      });
      if (cancelled) return;
      if (result.ok === false) {
        setPhase({ kind: 'error', message: explainPreviewError(result.error) });
        return;
      }
      setPhase({ kind: 'ready', preview: result });
    })();
    return () => {
      cancelled = true;
    };
  }, [open, conversationId, workspaceId, promptEventId, previewRewind]);

  const totals = useMemo(() => {
    if (phase.kind !== 'ready') return null;
    let additions = 0;
    let deletions = 0;
    let alreadyReverted = 0;
    for (const f of phase.preview.files) {
      additions += f.additions;
      deletions += f.deletions;
      if (f.alreadyReverted) alreadyReverted += 1;
    }
    return {
      additions,
      deletions,
      fileCount: phase.preview.files.length,
      runCount: phase.preview.runIds.length,
      alreadyReverted,
      everyAlreadyReverted:
        phase.preview.files.length > 0 &&
        alreadyReverted === phase.preview.files.length
    };
  }, [phase]);

  const isEdit = intent.kind === 'edit';
  const trimmedEdit = editText.trim();
  const editChanged =
    isEdit && trimmedEdit !== intent.originalContent.trim();
  // Disable the primary action when edit-mode would send an empty
  // prompt — sending an empty string downgrades to a no-op turn the
  // user can't see, and silently turns Edit & resend into Revert.
  const editConfirmDisabled =
    isEdit && (trimmedEdit.length === 0 || (model ?? null) === null);

  const primaryDisabled =
    phase.kind !== 'ready' ||
    (isEdit ? editConfirmDisabled : false);

  const handleConfirm = async () => {
    if (phase.kind !== 'ready') return;
    if (!conversationId || !workspaceId || !promptEventId) return;
    if (isEdit) {
      if (trimmedEdit.length === 0) return;
      if (!model) {
        showToast(
          'Edit & resend needs an active model — pick one in the composer first.',
          'danger'
        );
        return;
      }
    }

    setPhase({ kind: 'reverting' });
    const result = await rewindToPrompt({ conversationId, workspaceId, promptEventId });
    if (result.ok === false) {
      const msg = explainPreviewError(result.error);
      showToast(`Revert failed: ${msg}`, 'danger');
      setPhase({ kind: 'error', message: msg });
      return;
    }
    const failedCount = result.failedFiles.length;
    if (failedCount > 0) {
      showToast(
        `Reverted ${result.revertedFiles.length} file${result.revertedFiles.length === 1 ? '' : 's'}, ` +
        `${failedCount} could not be reverted (see logs).`,
        'danger'
      );
    } else if (result.revertedFiles.length > 0 || result.removedTranscriptEvents > 0) {
      showToast(
        `Reverted ${result.revertedFiles.length} file${result.revertedFiles.length === 1 ? '' : 's'} ` +
        `and removed ${result.removedTranscriptEvents} transcript event${result.removedTranscriptEvents === 1 ? '' : 's'}.`,
        isEdit ? 'info' : 'success'
      );
    } else if (!isEdit) {
      showToast('Conversation rewound — nothing to revert on disk.', 'info');
    }

    if (!isEdit) {
      onClose();
      return;
    }

    // Edit & resend: dispatch the amended prompt as a fresh turn.
    // We fire AFTER the rewind has settled (and the broadcast-driven
    // transcript refresh is in flight) so the new prompt lands at the
    // same conversation position the original occupied.
    setPhase({ kind: 'sending' });
    try {
      const permissions = selectEffectivePermissions(workspaceId, settings);
      await send(trimmedEdit, model!, permissions);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Could not resend the edited message: ${msg}`, 'danger');
    }
    onClose();
  };

  const isClosable =
    phase.kind !== 'reverting' && phase.kind !== 'sending';
  const titleCopy = isEdit
    ? 'Edit and resend this message'
    : 'Revert to before this message';
  const primaryLabel = isEdit
    ? phase.kind === 'sending'
      ? 'Sending…'
      : 'Rewind and send'
    : phase.kind === 'reverting'
      ? 'Reverting…'
      : 'Revert';
  const cancelLabel = isEdit ? 'Cancel edit' : 'Cancel';

  return (
    <Modal
      open={open}
      onClose={isClosable ? onClose : () => undefined}
      title={titleCopy}
      size="lg"
    >
      <div className="space-y-4">
        {phase.kind === 'loading' && (
          <div className="rounded-inner bg-surface-overlay px-3 py-2 text-row text-text-faint">
            Computing impact…
          </div>
        )}

        {phase.kind === 'error' && (
          <div className="flex items-start gap-2 rounded-inner bg-surface-overlay px-3 py-2 text-row text-text-secondary">
            <AlertTriangle
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning"
              strokeWidth={2}
            />
            <div className="min-w-0 flex-1">
              <div className="font-medium text-text-primary">
                {isEdit
                  ? 'Could not prepare the edit preview'
                  : 'Could not compute revert preview'}
              </div>
              <div className="mt-0.5 whitespace-pre-wrap text-text-muted">
                {phase.message}
              </div>
            </div>
          </div>
        )}

        {(phase.kind === 'reverting' || phase.kind === 'sending') && (
          <div className="rounded-inner bg-surface-overlay px-3 py-2 text-row text-text-faint">
            {phase.kind === 'reverting'
              ? isEdit
                ? 'Rewinding before sending…'
                : 'Reverting…'
              : 'Sending edited message…'}
          </div>
        )}

        {phase.kind === 'ready' && totals && (
          <>
            {isEdit ? (
              <EditPromptBanner
                ref={editTextareaRef}
                value={editText}
                onChange={setEditText}
                originalContent={intent.originalContent}
                editChanged={editChanged}
                transcriptEventsAffected={phase.preview.transcriptEventsAffected}
                fileCount={totals.fileCount}
                additions={totals.additions}
                deletions={totals.deletions}
                runCount={totals.runCount}
                modelMissing={!model}
              />
            ) : (
              <PromptPreviewBanner
                content={phase.preview.promptContent}
                transcriptEventsAffected={phase.preview.transcriptEventsAffected}
                fileCount={totals.fileCount}
                additions={totals.additions}
                deletions={totals.deletions}
                runCount={totals.runCount}
              />
            )}

            {totals.everyAlreadyReverted && (
              <div className="flex items-start gap-2 rounded-inner bg-surface-overlay px-3 py-2 text-row text-text-muted">
                <Undo2
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-muted"
                  strokeWidth={2}
                />
                <div className="min-w-0 flex-1">
                  All file changes from this turn were already reverted
                  manually.{' '}
                  {isEdit
                    ? 'Confirming will only trim the conversation transcript before sending the edited message.'
                    : 'Confirming will only trim the conversation transcript.'}
                </div>
              </div>
            )}

            {phase.preview.files.length === 0 ? (
              <div className="rounded-inner bg-surface-overlay px-3 py-2 text-row text-text-muted">
                No file changes were recorded for this run.{' '}
                {isEdit
                  ? 'Confirming will trim the conversation transcript and send the edited message.'
                  : 'Confirming will only rewind the conversation transcript.'}
              </div>
            ) : (
              <div className="scrollbar-stealth flex max-h-[36vh] flex-col overflow-y-auto rounded-inner bg-surface-overlay/60">
                {phase.preview.files.map((f) => (
                  <RevertFileRow key={f.entryId} change={f} />
                ))}
              </div>
            )}
          </>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose} disabled={!isClosable}>
            {cancelLabel}
          </Button>
          <Button
            variant={isEdit ? 'primary' : 'secondary'}
            onClick={() => void handleConfirm()}
            disabled={primaryDisabled}
          >
            {primaryLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

interface PromptPreviewBannerProps {
  content: string;
  transcriptEventsAffected: number;
  fileCount: number;
  additions: number;
  deletions: number;
  runCount: number;
}

function PromptPreviewBanner({
  content,
  transcriptEventsAffected,
  fileCount,
  additions,
  deletions,
  runCount
}: PromptPreviewBannerProps) {
  const trimmed = content.trim();
  const preview = trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed;
  return (
    <div className="space-y-2">
      <div className="rounded-inner bg-surface-overlay px-3 py-2 text-row text-text-secondary">
        <div className="text-meta uppercase tracking-wide text-text-faint">
          Reverting to before this message
        </div>
        <div className="mt-1 whitespace-pre-wrap text-text-primary">
          {preview || <span className="text-text-faint">(empty prompt)</span>}
        </div>
      </div>
      <ImpactStrip
        transcriptEventsAffected={transcriptEventsAffected}
        fileCount={fileCount}
        additions={additions}
        deletions={deletions}
        runCount={runCount}
      />
    </div>
  );
}

interface EditPromptBannerProps {
  value: string;
  onChange: (next: string) => void;
  originalContent: string;
  editChanged: boolean;
  transcriptEventsAffected: number;
  fileCount: number;
  additions: number;
  deletions: number;
  runCount: number;
  modelMissing: boolean;
}

const EditPromptBanner = forwardRef<HTMLTextAreaElement, EditPromptBannerProps>(
  function EditPromptBanner(
    {
      value,
      onChange,
      originalContent,
      editChanged,
      transcriptEventsAffected,
      fileCount,
      additions,
      deletions,
      runCount,
      modelMissing
    },
    ref
  ) {
    const trimmed = value.trim();
    const isEmpty = trimmed.length === 0;
    return (
      <div className="space-y-2">
        <div className="rounded-inner bg-surface-overlay px-3 py-2">
          <div className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-text-faint">
            <Pencil className="h-3 w-3" strokeWidth={2.25} />
            Edit and resend
          </div>
          <textarea
            ref={ref}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={2}
            spellCheck={false}
            aria-label="Edit message text"
            className={cn(
              'mt-1 w-full resize-none bg-transparent text-body leading-6 text-text-primary',
              'placeholder:text-text-faint outline-none focus:outline-none'
            )}
            placeholder="Edit your message…"
          />
          {originalContent.trim() && (
            <div
              className="mt-1 truncate text-meta text-text-faint"
              title={originalContent}
            >
              Original: {originalContent.trim().slice(0, 120)}
              {originalContent.trim().length > 120 ? '…' : ''}
            </div>
          )}
        </div>
        {isEmpty && (
          <div className="rounded-inner bg-surface-overlay px-3 py-1.5 text-row text-warning">
            The edited message is empty. Type something to send.
          </div>
        )}
        {!isEmpty && !editChanged && (
          <div className="rounded-inner bg-surface-overlay px-3 py-1.5 text-row text-text-muted">
            Message is unchanged — sending will resubmit the original prompt
            after the rewind.
          </div>
        )}
        {modelMissing && (
          <div className="rounded-inner bg-surface-overlay px-3 py-1.5 text-row text-warning">
            No model is selected — pick one in the composer before resending.
          </div>
        )}
        <ImpactStrip
          transcriptEventsAffected={transcriptEventsAffected}
          fileCount={fileCount}
          additions={additions}
          deletions={deletions}
          runCount={runCount}
        />
      </div>
    );
  }
);

function ImpactStrip({
  transcriptEventsAffected,
  fileCount,
  additions,
  deletions,
  runCount
}: {
  transcriptEventsAffected: number;
  fileCount: number;
  additions: number;
  deletions: number;
  runCount: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-row text-text-muted">
      <span className="inline-flex items-center gap-1">
        <FileWarning className="h-3.5 w-3.5 text-warning" strokeWidth={2} />
        <span className="text-text-primary">
          {fileCount} file{fileCount === 1 ? '' : 's'}
        </span>{' '}
        will be reverted
        {fileCount > 0 && (
          <span className="text-text-faint">
            (+{additions} −{deletions})
          </span>
        )}
      </span>
      {runCount > 0 && (
        <span className="inline-flex items-center gap-1">
          <History className="h-3.5 w-3.5 text-text-muted" strokeWidth={2} />
          <span className="text-text-primary">
            {runCount} run{runCount === 1 ? '' : 's'}
          </span>{' '}
          will be rolled back
        </span>
      )}
      <span className="inline-flex items-center gap-1">
        <MessageSquare className="h-3.5 w-3.5 text-text-muted" strokeWidth={2} />
        <span className="text-text-primary">
          {transcriptEventsAffected} transcript event
          {transcriptEventsAffected === 1 ? '' : 's'}
        </span>{' '}
        will be removed
      </span>
    </div>
  );
}

function explainPreviewError(error: {
  kind: string;
  conversationId?: string;
  promptEventId?: string;
  hash?: string;
  message?: string;
  runId?: string;
}): string {
  switch (error.kind) {
    case 'unknown-conversation':
      return 'This conversation has no recorded events to rewind.';
    case 'unknown-prompt':
      return 'This message is no longer in the transcript — it may have already been rewound.';
    case 'no-run-binding':
      return 'No file changes are linked to this message — there is nothing to revert.';
    case 'blob-missing':
      return `A snapshot blob is missing on disk${error.hash ? ` (${error.hash.slice(0, 8)}…)` : ''}.`;
    case 'sandbox':
      return error.message ?? 'Revert blocked by sandbox boundary.';
    case 'fs':
      return error.message ?? 'Filesystem error.';
    default:
      return `Unknown error (${error.kind}).`;
  }
}
