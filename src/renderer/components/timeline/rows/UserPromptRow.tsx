/**
 * Renders a right-aligned plain-text prompt. Long prompts collapse behind a
 * subtle fade and expand into an internally-scrollable bubble.
 *
 * The hover-reveal action strip carries three quiet affordances:
 *   - `Copy` — clipboard write of the prompt content.
 *   - `Edit` — opens the rewind-preview modal in EDIT mode for this
 *     turn. The user can amend the original prompt text inline; on
 *     confirm the modal first rewinds (atomic file + transcript
 *     rollback to before the prompt) and THEN dispatches the edited
 *     text as a fresh send. This is the "edit and send" workflow
 *     done correctly — the previous implementation only seeded the
 *     composer with the original text, which left the user editing
 *     a "future" message that conflicted with still-visible
 *     assistant output below. Disabled when no provider is mounted,
 *     while the conversation is processing, or when no `id` is
 *     supplied (legacy fixtures).
 *   - `Revert` — opens the same rewind-preview modal in REVERT mode.
 *     Pure rollback to the moment before the prompt. Disabled while
 *     the active conversation is `isProcessing` so the rewind never
 *     races a still-streaming run.
 *
 * The Edit / Revert affordances carry an inline numeric badge showing
 * how many file edits the prompt's turn produced. The count is read
 * from `useChatStore.runIdToFileEditCount[runId]` (maintained
 * incrementally by the timeline reducer's `file-edit` branch);
 * rendered only when `runId` is threaded down AND the count is > 0
 * so quiet "no FS impact" turns stay visually flat.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Copy, Check, Pencil, Undo2 } from 'lucide-react';
import { cn } from '../../../lib/cn.js';
import { safeCopy } from '../../../lib/clipboard.js';
import { useChatStore } from '../../../store/useChatStore.js';
import { useRevertPrompt } from '../revert/RevertPromptContext.js';
import {
  SurfaceShell,
  surfaceShellInnerClassName
} from '../../ui/SurfaceShell.js';
import { timelineActionPillClassName } from '../shared/rowStyles.js';

interface UserPromptRowProps {
  /**
   * Original `user-prompt` event id. Threaded down so the inline
   * Revert action can bind the rewind to this exact turn. Optional so
   * legacy test fixtures and any future stand-alone mounts keep
   * working — the Revert affordance simply hides when no id is
   * supplied.
   */
  id?: string;
  /**
   * Originating run id for this prompt's turn. Optional so legacy
   * transcripts persisted before the field was added still render
   * (the badge just shows no count). Used purely as a key into
   * `runIdToFileEditCount` for the inline numeric badge.
   */
  runId?: string;
  content: string;
}

const COLLAPSED_MAX_PX = 144;

const EXPANDED_MAX_PX = 320;

export function UserPromptRow({ id, runId, content }: UserPromptRowProps) {
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Provider hook is allowed to return `null` so isolated mounts (the
  // existing `UserPromptRow.test.tsx` fixtures) keep working without
  // having to wire the whole revert subsystem. When `null`, the
  // Revert / Edit affordances render disabled with an explanatory
  // title.
  const revertCtx = useRevertPrompt();
  // Active slice's processing flag — disable Revert / Edit while the
  // conversation is streaming so the rewind never races a live run.
  const isProcessing = useChatStore((s) => s.isProcessing);
  // O(1) per-turn FS-impact count maintained by the timeline reducer.
  // Selector pulls a single bucket so a streaming sub-agent's
  // file-edits in a sibling turn never re-render this row. `0` for
  // legacy transcripts whose `file-edit` events lack a `runId`.
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
  // Suffix the file-impact count when the row is actually actionable
  // and has a non-zero count so the unavailable copy stays terse.
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
    <div className="group flex flex-col gap-1" data-row-kind="user-prompt">
      <SurfaceShell className={surfaceShellInnerClassName('content')}>
        <div className="mb-1 text-meta font-medium uppercase tracking-wider text-text-faint">
          You
        </div>
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
              className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-surface-raised/80 to-transparent"
            />
          )}
        </div>
      </SurfaceShell>
      <div className="flex flex-wrap items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
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
            'rounded-inner px-1.5 py-0.5 text-row text-text-faint transition-colors duration-150',
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
  /**
   * Click handler. May return `void` (synchronous fire-and-forget,
   * e.g. open a modal) or a `Promise<boolean>` — when it returns a
   * promise AND `copiedIcon` is set, the "Copied" success state only
   * flips after the promise resolves `true`. Without this gate a
   * failed clipboard write would still paint the green check for
   * 1.2 s and lie to the user.
   */
  onClick: () => void | Promise<boolean>;
  /** When true the button renders muted + non-interactive. */
  disabled?: boolean;
  /** Optional tooltip override — falls back to `label`. */
  title?: string;
  /**
   * Optional numeric badge rendered after the label. Only used by the
   * Revert / Edit actions to surface the per-turn file-edit count
   * without adding an extra row to the timeline. Hidden when undefined
   * or 0.
   */
  badge?: number;
}) {
  const [copied, setCopied] = useState(false);
  // Cleanup any pending "copied" reset so a fast unmount can't leak a
  // timer onto a torn-down component. Vital for the always-on agent
  // posture: a long-lived chat with hundreds of prompt rows that all
  // mount/unmount on tab switch must not accumulate timeouts.
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
    // Synchronous `void`-returning handlers are treated as
    // unconditional success — that preserves the prior contract for
    // any future PromptAction whose click handler isn't a copy
    // (e.g. the Edit / Revert actions never set `copiedIcon` so
    // they never reach this branch). Promise-returning handlers
    // are awaited so the success state only paints on `true`.
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
          // Quiet inline counter; uses the same `text-meta` rhythm
          // as the rest of the toolbar's small labels and only
          // brightens to `text-primary` because the parent button
          // already supplies a hover transition for the surrounding
          // text. `aria-hidden` keeps screen readers on the explicit
          // `aria-label` (which already contains the count).
          aria-hidden
          className="ml-0.5 inline-flex min-w-[1ch] items-center justify-center rounded-inner bg-surface-overlay px-1 text-meta tabular-nums text-text-muted"
        >
          {badge}
        </span>
      )}
    </button>
  );
}
