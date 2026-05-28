/**
 * Renders the user's prompt as flush markdown-ready text in the agent
 * reading column (no card, no eyebrow, no right-alignment).
 *
 * Hover-reveal actions: Copy and Edit (rewind + resend).
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Copy, Check, Pencil } from 'lucide-react';
import type { PromptAttachmentMeta } from '@shared/types/chat.js';
import { PromptAttachmentCards } from '../../composer/PromptAttachmentCards.js';
import { cn } from '../../../lib/cn.js';
import { SHELL_ACTION_ICON_STROKE, SHELL_ROW_ICON_CLASS } from '../../../lib/shellIcons.js';
import { safeCopy } from '../../../lib/clipboard.js';
import { useChatStore } from '../../../store/useChatStore.js';
import { useRevertPrompt } from '../revert/RevertPromptContext.js';
import {
  timelineActionPillClassName,
  timelineAgentColumnClassName,
  timelineUserPromptBodyClassName
} from '../shared/rowStyles.js';

interface UserPromptRowProps {
  id?: string;
  runId?: string;
  content: string;
  attachments?: PromptAttachmentMeta[];
  /** Last turn while the agent is still running. */
  live?: boolean;
}

const COLLAPSED_MAX_PX = 144;

const EXPANDED_MAX_PX = 320;

export function UserPromptRow({
  id,
  runId,
  content,
  attachments = [],
  live = false
}: UserPromptRowProps) {
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const revertCtx = useRevertPrompt();
  const isProcessing = useChatStore((s) => s.isProcessing);
  const fileEditCount = useChatStore((s) =>
    runId ? (s.runIdToFileEditCount[runId] ?? 0) : 0
  );

  const actionAvailable = Boolean(id) && revertCtx !== null && !isProcessing;
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
  const fileSuffix =
    actionAvailable && fileEditCount > 0
      ? ` (${fileEditCount} file change${fileEditCount === 1 ? '' : 's'})`
      : '';
  const editTitle = `${editTitleBase}${fileSuffix}`;

  useLayoutEffect(() => {
    const el = bubbleRef.current;
    if (!el) return;

    const measure = () => {
      const natural = el.scrollHeight;
      setOverflows(natural > COLLAPSED_MAX_PX + 4);
    };

    measure();

    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, [content]);

  useEffect(() => {
    if (!overflows && expanded) setExpanded(false);
  }, [overflows, expanded]);

  const showToggle = overflows;
  const maxHeightPx = showToggle
    ? expanded
      ? EXPANDED_MAX_PX
      : COLLAPSED_MAX_PX
    : undefined;

  return (
    <div
      className={cn(
        'group flex flex-col gap-1',
        timelineAgentColumnClassName,
        !live && 'vyotiq-stepfade-once'
      )}
      data-row-kind="user-prompt"
    >
      <div className="relative">
        <div
          ref={bubbleRef}
          className={cn(
            'vx-timeline-user-bubble pl-3',
            timelineUserPromptBodyClassName,
            showToggle && !expanded && 'overflow-hidden',
            showToggle && expanded && 'overflow-y-auto scrollbar-stealth max-h-80'
          )}
          style={maxHeightPx !== undefined ? { maxHeight: maxHeightPx } : undefined}
        >
          {content}
        </div>
        {attachments.length > 0 && (
          <PromptAttachmentCards items={attachments} className="mt-2" />
        )}
        {showToggle && !expanded && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-surface-base via-surface-base/60 to-transparent"
          />
        )}
      </div>
      <div
        {...(live ? { 'data-live-prompt-actions': 'true' } : {})}
        className={cn(
          'flex flex-wrap items-center justify-start gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100'
        )}
      >
        <PromptAction
          label="Copy"
          icon={<Copy className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />}
          copiedIcon={<Check className={cn(SHELL_ROW_ICON_CLASS, 'text-success')} strokeWidth={SHELL_ACTION_ICON_STROKE} />}
          onClick={() => safeCopy(content, { context: 'user-prompt' })}
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
      {showToggle && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="self-start vx-btn vx-btn-quiet px-1.5 py-0.5 text-chat-meta"
          aria-expanded={expanded}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
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
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
        copyTimerRef.current = null;
      }
    };
  }, []);
  const flipCopied = () => {
    if (!mountedRef.current) return;
    setCopied(true);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => {
      if (!mountedRef.current) return;
      setCopied(false);
    }, 1200);
  };
  const handleClick = () => {
    if (disabled) return;
    const result = onClick();
    if (!copiedIcon) return;
    if (result && typeof (result as Promise<boolean>).then === 'function') {
      void (result as Promise<boolean>).then((ok) => {
        if (ok) flipCopied();
      });
    } else {
      flipCopied();
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
        disabled && 'cursor-not-allowed opacity-40'
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
