/**
 * Inline edit / revert composer — replaces the user prompt bubble in the
 * timeline. Edit mode is compact (text + send); model and attachments use
 * the footer composer.
 */

import { useEffect, useRef } from 'react';
import { Pencil, Undo2 } from 'lucide-react';
import type { ModelSelection } from '@shared/types/provider.js';
import type { PromptAttachmentMeta } from '@shared/types/chat.js';
import { MentionComposer } from '../../composer/mention/MentionComposer.js';
import {
  documentTrimmedPlain,
  extractMentions,
  hasComposerContent,
  parseMentionDocument
} from '../../composer/mention/mentionDocument.js';
import { pickComputerFileMention } from '../../composer/mention/useMentionComputerPick.js';
import { useComposerAttachments } from '../../composer/useComposerAttachments.js';
import { SendButton } from '../../composer/SendButton.js';
import { Button } from '../../ui/Button.js';
import { Notice } from '../../ui/Notice.js';
import { appComposerShellClassName } from '../../ui/SurfaceShell.js';
import { cn } from '../../../lib/cn.js';
import { SHELL_ACTION_ICON_STROKE, SHELL_ROW_ICON_CLASS } from '../../../lib/shellIcons.js';
import type { RevertIntent } from './RevertPromptContext.js';
import { useRewindPromptSession } from './useRewindPromptSession.js';
import { RewindImpactSummary } from './RewindImpactSummary.js';

const TEXTAREA_MAX_HEIGHT = 168;

/** Clicks here should not dismiss the inline session (separate from footer composer). */
function isClickOutsideIgnored(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return !!target.closest(
    '.vx-popover-panel, [data-popover-side], [data-chat-footer], .vx-mention-composer'
  );
}

interface InlinePromptSessionProps {
  conversationId: string;
  workspaceId: string;
  promptEventId: string;
  intent: RevertIntent;
  model: ModelSelection | null;
  onModelChange: (sel: ModelSelection) => void;
  onOpenProviders: () => void;
  initialAttachments?: PromptAttachmentMeta[];
  onCancel: () => void;
}

export function InlinePromptSession({
  conversationId,
  workspaceId,
  promptEventId,
  intent,
  model,
  onModelChange: _onModelChange,
  onOpenProviders: _onOpenProviders,
  initialAttachments = [],
  onCancel
}: InlinePromptSessionProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  const {
    attachments,
    setAttachments,
    peekPendingMessageId
  } = useComposerAttachments({
    conversationId,
    workspaceId,
    initialAttachments
  });

  useEffect(() => {
    setAttachments(initialAttachments);
  }, [promptEventId, initialAttachments, setAttachments]);

  const session = useRewindPromptSession({
    conversationId,
    workspaceId,
    promptEventId,
    intent,
    model,
    attachmentCount: attachments.length,
    onComplete: onCancel
  });

  const editDoc = parseMentionDocument(session.editText);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || session.isBusy) return;
      const active = document.activeElement;
      if (active?.closest('.vx-mention-composer')) return;
      e.preventDefault();
      onCancel();
    };
    const onPointer = (e: MouseEvent) => {
      if (session.isBusy) return;
      if (isClickOutsideIgnored(e.target)) return;
      const root = rootRef.current;
      if (!root || root.contains(e.target as Node)) return;
      onCancel();
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [onCancel, session.isBusy]);

  const canSend =
    session.isEdit &&
    (hasComposerContent(editDoc) || attachments.length > 0) &&
    !!model;
  const sendState = session.isBusy ? 'processing' : canSend ? 'ready' : 'idle';

  const primaryLabel = session.isEdit
    ? session.phase.kind === 'sending'
      ? 'Sending…'
      : 'Rewind and send'
    : session.phase.kind === 'reverting'
      ? 'Reverting…'
      : 'Revert';

  const handlePrimary = () => {
    const mentions = extractMentions(editDoc);
    const attachId = attachments.length > 0 ? peekPendingMessageId() : undefined;
    void session.confirm(attachments, attachId, mentions.length > 0 ? mentions : undefined);
  };

  const impact =
    session.phase.kind === 'ready' && session.totals ? (
      <RewindImpactSummary
        {...session.totals}
        transcriptEventsAffected={session.phase.preview.transcriptEventsAffected}
        className="px-0.5 pb-1"
      />
    ) : null;

  return (
    <div
      ref={rootRef}
      className={cn(
        'vyotiq-inline-prompt-session w-full ring-1 ring-accent/30',
        appComposerShellClassName
      )}
      role="form"
      aria-label={session.isEdit ? 'Edit and resend message' : 'Revert to before this message'}
    >
      <div className="flex min-w-0 flex-col gap-1 p-2">
        <div className="flex items-center gap-1.5 text-meta text-text-muted">
          {session.isEdit ? (
            <Pencil className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
          ) : (
            <Undo2 className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
          )}
          <span className="font-medium text-text-secondary">
            {session.isEdit ? 'Edit and resend' : 'Revert to here'}
          </span>
        </div>

        {session.phase.kind === 'loading' && (
          <Notice tone="info" size="sm">
            Computing impact…
          </Notice>
        )}
        {session.phase.kind === 'error' && (
          <Notice tone="warning" size="sm">
            {session.phase.message}
          </Notice>
        )}
        {session.isProcessing && session.phase.kind === 'ready' && (
          <Notice tone="warning" size="sm">
            A run is still active — continuing will interrupt it.
          </Notice>
        )}
        {impact &&
          (session.isEdit ? (
            <details className="group text-meta">
              <summary className="cursor-pointer select-none text-text-muted hover:text-text-secondary">
                View rewind impact
              </summary>
              <div className="pt-1">{impact}</div>
            </details>
          ) : (
            impact
          ))}

        {!session.isEdit && session.phase.kind === 'ready' && (
          <p className="whitespace-pre-wrap text-body text-text-primary">
            {session.phase.preview.promptContent.trim() || (
              <span className="text-text-faint">(empty prompt)</span>
            )}
          </p>
        )}

        {session.isEdit && (
          <>
            <div className="vx-composer-input-zone vx-composer-input-zone--footer">
              <div className="vx-composer-input-row">
                <MentionComposer
                  value={session.editText}
                  onChange={(next) => session.setEditText(next)}
                  onPickFromComputer={async () =>
                    pickComputerFileMention({
                      conversationId,
                      workspaceId,
                      messageId: peekPendingMessageId()
                    })
                  }
                  placeholder="@ to mention files, or describe your task…"
                  className="min-h-[1.75rem] min-w-0 flex-1 leading-5"
                  style={{ maxHeight: TEXTAREA_MAX_HEIGHT }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      if (!session.primaryDisabled) handlePrimary();
                    }
                  }}
                />
                <SendButton
                  onClick={handlePrimary}
                  state={sendState}
                  disabled={session.primaryDisabled}
                />
              </div>
            </div>
            {!hasComposerContent(editDoc) && attachments.length === 0 && (
              <p className="text-meta text-warning">Type a message to send.</p>
            )}
            {!model && (
              <p className="text-meta text-warning">Select a model in the composer below to resend.</p>
            )}
            {hasComposerContent(editDoc) &&
              intent.kind === 'edit' &&
              documentTrimmedPlain(editDoc) === intent.originalContent.trim() && (
                <p className="text-meta text-text-muted">
                  Unchanged — will resubmit the original prompt after rewind.
                </p>
              )}
          </>
        )}

        <div className="flex justify-end gap-2 border-t border-border-subtle/20 pt-2">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={session.isBusy}>
            Cancel
          </Button>
          {!session.isEdit && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handlePrimary}
              disabled={session.primaryDisabled}
            >
              {primaryLabel}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
