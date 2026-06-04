/**
 * Renders the user's prompt as flush markdown-ready text in the agent
 * reading column (no card, no eyebrow, no right-alignment).
 *
 * Hover-reveal actions: Copy, Revert, and Edit (rewind + resend).
 */

import { Copy, Check, Pencil, Undo2 } from 'lucide-react';
import type { PromptAttachmentMeta } from '@shared/types/chat.js';
import { PromptAttachmentCards } from '../../composer/PromptAttachmentCards.js';
import { cn } from '../../../lib/cn.js';
import { SHELL_ACTION_ICON_STROKE, SHELL_ROW_ICON_CLASS } from '../../../lib/shellIcons.js';
import { safeCopy } from '../../../lib/clipboard.js';
import { useCopyFeedback } from '../../../hooks/useCopyFeedback.js';
import { useChatStore } from '../../../store/useChatStore.js';
import { useRevertPrompt } from '../revert/RevertPromptContext.js';
import { InlinePromptSession } from '../revert/InlinePromptSession.js';
import {
  timelineActionPillClassName,
  timelineAgentColumnClassName
} from '../shared/rowStyles.js';
import { PromptBody } from './PromptBody.js';

interface UserPromptRowProps {
  id?: string;
  runId?: string;
  content: string;
  attachments?: PromptAttachmentMeta[];
  /** Last turn while the agent is still running. */
  live?: boolean;
}

export function UserPromptRow({
  id,
  runId,
  content,
  attachments = [],
  live = false
}: UserPromptRowProps) {
  const revertCtx = useRevertPrompt();
  const isProcessing = useChatStore((s) => s.isProcessing);
  const inlineSession =
    revertCtx?.activeSession && id && revertCtx.activeSession.promptEventId === id
      ? revertCtx.activeSession
      : null;
  const fileEditCount = useChatStore((s) =>
    runId ? (s.runIdToFileEditCount[runId] ?? 0) : 0
  );

  const sessionBlocksActions = Boolean(revertCtx?.isSessionOpen && !inlineSession);
  const actionAvailable =
    Boolean(id) && revertCtx !== null && !isProcessing && !sessionBlocksActions;
  const baseUnavailableTitle = !id
    ? ' is unavailable here'
    : revertCtx === null
      ? ' is unavailable here'
      : isProcessing
        ? ' is unavailable while this conversation is running'
        : null;
  const editTitleBase =
    baseUnavailableTitle === null
      ? 'Edit and resend this message'
      : `Edit & resend${baseUnavailableTitle}`;
  const revertTitleBase =
    baseUnavailableTitle === null
      ? 'Revert to before this message'
      : `Revert${baseUnavailableTitle}`;
  const fileSuffix =
    actionAvailable && fileEditCount > 0
      ? ` (${fileEditCount} file change${fileEditCount === 1 ? '' : 's'})`
      : '';
  const editTitle = `${editTitleBase}${fileSuffix}`;
  const revertTitle = `${revertTitleBase}${fileSuffix}`;

  return (
    <div
      className={cn(
        'group flex flex-col gap-1',
        timelineAgentColumnClassName,
        !live && 'vyotiq-stepfade-once'
      )}
      data-row-kind="user-prompt"
    >
      {inlineSession && revertCtx ? (
        <InlinePromptSession
          conversationId={inlineSession.conversationId}
          workspaceId={inlineSession.workspaceId}
          promptEventId={inlineSession.promptEventId}
          intent={inlineSession.intent}
          model={revertCtx.model}
          onModelChange={revertCtx.onModelChange}
          onOpenProviders={revertCtx.onOpenProviders}
          initialAttachments={attachments}
          onCancel={revertCtx.closeSession}
        />
      ) : (
        <>
          <PromptBody content={content} />
          {attachments.length > 0 && (
            <PromptAttachmentCards items={attachments} className="mt-2" />
          )}
        </>
      )}
      {!inlineSession && (
      <div
        {...(live ? { 'data-live-prompt-actions': 'true' } : {})}
        className={cn(
          'flex flex-wrap items-center justify-start gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100'
        )}
      >
        <PromptAction
          label="Copy"
          icon={<Copy className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />}
          copiedIcon={<Check className={cn(SHELL_ROW_ICON_CLASS, 'text-success')} strokeWidth={SHELL_ACTION_ICON_STROKE} />}
          onClick={() => safeCopy(content, { context: 'user-prompt' })}
        />
        <PromptAction
          label="Revert"
          icon={<Undo2 className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />}
          {...(actionAvailable && fileEditCount > 0 ? { badge: fileEditCount } : {})}
          disabled={!actionAvailable}
          title={revertTitle}
          onClick={() => {
            if (!actionAvailable || !id || !revertCtx) return;
            revertCtx.requestRevert({ promptEventId: id });
          }}
        />
        <PromptAction
          label="Edit"
          icon={<Pencil className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />}
          {...(actionAvailable && fileEditCount > 0 ? { badge: fileEditCount } : {})}
          disabled={!actionAvailable}
          title={editTitle}
          onClick={() => {
            if (!actionAvailable || !id || !revertCtx) return;
            revertCtx.requestEditAndResend({ promptEventId: id, content });
          }}
        />
      </div>
      )}
    </div>
  );
}

function PromptAction({
  label,
  icon,
  copiedIcon,
  onClick,
  disabled,
  title,
  badge
}: {
  label: string;
  icon: React.ReactNode;
  copiedIcon?: React.ReactNode;
  onClick: () => void | Promise<boolean>;
  disabled?: boolean;
  title?: string;
  badge?: number;
}) {
  const { copied, flag } = useCopyFeedback();
  const handleClick = () => {
    if (disabled) return;
    const result = onClick();
    if (!copiedIcon) return;
    if (result && typeof (result as Promise<boolean>).then === 'function') {
      void (result as Promise<boolean>).then((ok) => {
        if (ok) flag();
      });
    } else {
      flag();
    }
  };
  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={title ?? label}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      className={cn(
        timelineActionPillClassName,
        disabled && 'cursor-not-allowed opacity-40',
        'focus-visible:opacity-100'
      )}
      title={title ?? label}
    >
      {copied && copiedIcon ? copiedIcon : icon}
      <span>{copied && copiedIcon ? 'Copied' : label}</span>
      {!copied && typeof badge === 'number' && badge > 0 && (
        <span
          aria-hidden
          className="ml-0.5 min-w-[1ch] tabular-nums text-chat-meta text-text-muted"
        >
          {badge}
        </span>
      )}
    </button>
  );
}
