/**
 * Inline edit / revert composer — replaces the user prompt bubble in the
 * timeline. Reuses the main composer shell, model picker, and attachments.
 */

import { useEffect, useRef, useState } from 'react';
import { Pencil, Undo2 } from 'lucide-react';
import type { ModelSelection } from '@shared/types/provider.js';
import type { PromptAttachmentMeta } from '@shared/types/chat.js';
import { MAX_CHAT_ATTACHMENTS } from '@shared/constants.js';
import { AttachmentButton } from '../../composer/AttachmentButton.js';
import { detectAtToken } from '../../composer/atToken.js';
import { ModelPicker } from '../../composer/modelPicker/index.js';
import { PromptAttachmentCards } from '../../composer/PromptAttachmentCards.js';
import { useComposerAttachments } from '../../composer/useComposerAttachments.js';
import { SendButton } from '../../composer/SendButton.js';
import { Button } from '../../ui/Button.js';
import { Notice } from '../../ui/Notice.js';
import {
  appComposerShellClassName,
  appComposerTextareaClassName
} from '../../ui/SurfaceShell.js';
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
    '.vx-popover-panel, [data-popover-side], [data-chat-footer]'
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
  onModelChange,
  onOpenProviders,
  initialAttachments = [],
  onCancel
}: InlinePromptSessionProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [atMention, setAtMention] = useState<{ start: number; query: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const {
    attachments,
    setAttachments,
    addPaths,
    pickFromComputer,
    remove: removeAttachment,
    peekPendingMessageId,
    onDrop,
    onDragOver
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

  useEffect(() => {
    if (!session.isEdit) return;
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT) + 'px';
  }, [session.editText, session.isEdit, session.phase.kind]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || session.isBusy) return;
      if (atMention) {
        setAtMention(null);
        e.preventDefault();
        return;
      }
      const active = document.activeElement;
      if (active instanceof HTMLTextAreaElement && active !== taRef.current) return;
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
  }, [onCancel, session.isBusy, atMention]);

  useEffect(() => {
    if (session.isEdit) {
      taRef.current?.focus();
    }
  }, [session.isEdit]);

  const onTextChange = (next: string) => {
    session.setEditText(next);
    const el = taRef.current;
    const cursor = el ? (el.selectionStart ?? next.length) : next.length;
    setAtMention(detectAtToken(next, cursor));
  };

  const onSelectionUpdate = () => {
    const el = taRef.current;
    if (!el) return;
    const cursor = el.selectionStart ?? session.editText.length;
    setAtMention(detectAtToken(session.editText, cursor));
  };

  const onMentionFilterChange = (nextQuery: string) => {
    if (!atMention) return;
    const text = session.editText;
    const before = text.slice(0, atMention.start + 1);
    const after = text.slice(atMention.start + 1 + atMention.query.length);
    const merged = before + nextQuery + after;
    session.setEditText(merged);
    setAtMention({ start: atMention.start, query: nextQuery });
    requestAnimationFrame(() => {
      const el = taRef.current;
      if (!el) return;
      const cursor = atMention.start + 1 + nextQuery.length;
      el.focus();
      el.setSelectionRange(cursor, cursor);
    });
  };

  const onMentionPick = (path: string) => {
    if (!atMention) {
      void addPaths([path]);
      return;
    }
    const text = session.editText;
    const before = text.slice(0, atMention.start);
    const after = text.slice(atMention.start + 1 + atMention.query.length);
    const collapsed =
      before.endsWith(' ') && after.startsWith(' ') ? before + after.slice(1) : before + after;
    session.setEditText(collapsed);
    void addPaths([path]);
    setAtMention(null);
    requestAnimationFrame(() => {
      const el = taRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(atMention.start, atMention.start);
    });
  };

  const canSend =
    session.isEdit &&
    (session.trimmedEdit.length > 0 || attachments.length > 0) &&
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
    const attachId = attachments.length > 0 ? peekPendingMessageId() : undefined;
    void session.confirm(attachments, attachId);
  };

  const selectedPaths = attachments.map(
    (a) => a.workspacePath ?? a.storedPath ?? a.name
  );

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
        appComposerShellClassName,
        dragOver && 'ring-2 ring-accent/35'
      )}
      onDragEnter={(e) => {
        e.preventDefault();
        if (e.dataTransfer.types.includes('Files')) setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setDragOver(false);
      }}
      onDragOver={onDragOver}
      onDrop={(e) => {
        setDragOver(false);
        onDrop(e);
      }}
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
        {impact}

        {!session.isEdit && session.phase.kind === 'ready' && (
          <p className="whitespace-pre-wrap text-body text-text-primary">
            {session.phase.preview.promptContent.trim() || (
              <span className="text-text-faint">(empty prompt)</span>
            )}
          </p>
        )}

        {session.isEdit && attachments.length > 0 && (
          <PromptAttachmentCards
            items={attachments}
            editable
            onRemove={removeAttachment}
            className="mb-0.5"
          />
        )}

        {session.isEdit && (
          <>
            <div className="vx-composer-chip-row">
              <AttachmentButton
                open={pickerOpen || !!atMention}
                onOpen={() => setPickerOpen(true)}
                onClose={() => {
                  setPickerOpen(false);
                  setAtMention(null);
                }}
                selected={selectedPaths}
                onPick={atMention ? onMentionPick : (p) => void addPaths([p])}
                onPickFromComputer={() => void pickFromComputer()}
                workspaceOnly={atMention !== null}
                {...(atMention ? { controlledFilter: atMention.query } : {})}
                {...(atMention ? { onControlledFilterChange: onMentionFilterChange } : {})}
              />
              <ModelPicker
                value={model}
                onChange={onModelChange}
                onOpenProviders={onOpenProviders}
              />
              {attachments.length > 0 && (
                <span className="shrink-0 font-mono text-meta text-text-faint tabular-nums">
                  {attachments.length}/{MAX_CHAT_ATTACHMENTS}
                </span>
              )}
            </div>
            <div className="vx-composer-input-zone vx-composer-input-zone--footer">
              <div className="vx-composer-input-row">
                <textarea
                  ref={taRef}
                  value={session.editText}
                  onChange={(e) => onTextChange(e.target.value)}
                  onKeyUp={onSelectionUpdate}
                  onClick={onSelectionUpdate}
                  onKeyDown={(e) => {
                    if (atMention && e.key === 'Escape') {
                      e.preventDefault();
                      setAtMention(null);
                      return;
                    }
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      if (!session.primaryDisabled) handlePrimary();
                    }
                  }}
                  rows={1}
                  spellCheck={false}
                  aria-label="Edit message text"
                  placeholder="@ to mention files, or describe your task…"
                  className={cn(
                    appComposerTextareaClassName,
                    'min-h-[1.75rem] min-w-0 flex-1 leading-5'
                  )}
                  style={{ maxHeight: TEXTAREA_MAX_HEIGHT }}
                />
                <SendButton
                  onClick={handlePrimary}
                  state={sendState}
                  disabled={session.primaryDisabled}
                />
              </div>
            </div>
            {session.trimmedEdit.length === 0 && attachments.length === 0 && (
              <p className="text-meta text-warning">Type a message or attach files to send.</p>
            )}
            {!model && (
              <p className="text-meta text-warning">Select a model to resend.</p>
            )}
            {session.trimmedEdit.length > 0 &&
              intent.kind === 'edit' &&
              session.trimmedEdit === intent.originalContent.trim() && (
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
