/**
 * Renders the user's prompt as flush markdown-ready text in the agent
 * reading column (no card, no eyebrow, no right-alignment).
 *
 * The May 2026 timeline restyle dropped the previous right-aligned
 * raised card + `You` eyebrow chrome in favor of a Cursor-style
 * single-column reading rail: every turn now shares the same flush
 * left edge so the prompt and the agent's reply sit on one vertical
 * column. User vs agent distinction is carried by content rhythm
 * (the prompt is rendered first in the turn block and exposes its
 * Copy/Edit/Revert affordances flush against the right edge of the
 * column). Long prompts still collapse behind a fade and expand into
 * an internally scrollable area.
 *
 * The hover-reveal action strip carries three quiet affordances:
 *   - `Copy` — clipboard write of the prompt content.
 *   - `Edit` — opens the rewind-preview modal in EDIT mode for this
 *     turn. The user can amend the original prompt text inline; on
 *     confirm the modal first rewinds (atomic file + transcript
 *     rollback to before the prompt) and THEN dispatches the edited
 *     text as a fresh send. Disabled when no provider is mounted,
 *     while the conversation is processing, or when no `id` is
 *     supplied (legacy fixtures).
 *   - `Revert` — opens the same rewind-preview modal in REVERT mode.
 *     Pure rollback to the moment before the prompt. Disabled while
 *     the active conversation is `isProcessing` so the rewind never
 *     races a still-streaming run.
 *
 * The Edit / Revert affordances carry an inline numeric badge showing
 * how many file edits the prompt's turn produced.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Copy, Check, Pencil, Undo2 } from 'lucide-react';
import { cn } from '../../../lib/cn.js';
import { safeCopy } from '../../../lib/clipboard.js';
import { useChatStore } from '../../../store/useChatStore.js';
import { useRevertPrompt } from '../revert/RevertPromptContext.js';
import {
  timelineActionPillClassName,
  timelineAgentColumnClassName
} from '../shared/rowStyles.js';

interface UserPromptRowProps {
  id?: string;
  runId?: string;
  content: string;
  /** Last turn while the agent is still running. */
  live?: boolean;
}

const COLLAPSED_MAX_PX = 144;

const EXPANDED_MAX_PX = 320;

export function UserPromptRow({ id, runId, content, live = false }: UserPromptRowProps) {
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
  const revertTitleBase =
    baseUnavailableTitle === null
      ? 'Revert to before this message'
      : `Revert${baseUnavailableTitle}`;
  const editTitleBase =
    baseUnavailableTitle === null
      ? 'Edit and resend this message'
      : `Edit & resend${baseUnavailableTitle}`;
  const fileSuffix =
    actionAvailable && fileEditCount > 0
      ? ` (${fileEditCount} file change${fileEditCount === 1 ? '' : 's'})`
      : '';
  const revertTitle = `${revertTitleBase}${fileSuffix}`;
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
            'whitespace-pre-wrap text-body leading-relaxed text-text-primary',
            showToggle && !expanded && 'overflow-hidden',
            showToggle && expanded && 'overflow-y-auto scrollbar-stealth max-h-80'
          )}
          style={maxHeightPx !== undefined ? { maxHeight: maxHeightPx } : undefined}
        >
          {content}
        </div>
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
          icon={<Copy className="h-3 w-3" strokeWidth={2.25} />}
          copiedIcon={<Check className="h-3 w-3 text-success" strokeWidth={2.25} />}
          onClick={() => safeCopy(content, { context: 'user-prompt' })}
        />
        <PromptAction
          label="Edit"
          icon={<Pencil className="h-3 w-3" strokeWidth={2.25} />}
          {...(actionAvailable && fileEditCount > 0 ? { badge: fileEditCount } : {})}
          disabled={!actionAvailable}
          title={editTitle}
          onClick={() => {
            if (!actionAvailable || !id || !revertCtx) return;
            revertCtx.requestEditAndResend({ promptEventId: id, content });
          }}
        />
        <PromptAction
          label="Revert"
          icon={<Undo2 className="h-3 w-3" strokeWidth={2.25} />}
          {...(actionAvailable && fileEditCount > 0 ? { badge: fileEditCount } : {})}
          disabled={!actionAvailable}
          title={revertTitle}
          onClick={() => {
            if (!actionAvailable || !id || !revertCtx) return;
            revertCtx.requestRevert({ promptEventId: id });
          }}
        />
      </div>
      {showToggle && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className={cn(
            'self-start rounded-inner px-1.5 py-0.5 text-row text-text-faint transition-colors duration-150',
            'hover:bg-surface-hover hover:text-text-primary'
          )}
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
          className="ml-0.5 min-w-[1ch] tabular-nums text-meta text-text-muted"
        >
          {badge}
        </span>
      )}
    </button>
  );
}
