/**
 * Inline `ask_user` row — interactive form expands in the timeline.
 */

import { useShallow } from 'zustand/react/shallow';
import type { AskUserStructuredPayload } from '@shared/types/askUser.js';
import { findPendingAskUserEvent } from '../../../lib/pendingAskUser.js';
import { useChatStore } from '../../../store/useChatStore.js';
import { cn } from '../../../lib/cn.js';
import { AskUserForm } from '../askUser/AskUserForm.js';

interface AskUserCompactRowProps {
  payload: AskUserStructuredPayload;
  displayText: string;
  promptEventId: string;
  status?: 'pending' | 'submitted';
}

export function AskUserCompactRow({
  payload,
  displayText,
  promptEventId,
  status
}: AskUserCompactRowProps) {
  const { awaitingAskUser, events } = useChatStore(
    useShallow((s) => ({
      awaitingAskUser: s.awaitingAskUser,
      events: s.events
    }))
  );
  const title = payload.title?.trim() || 'Clarifying questions';
  const pending = findPendingAskUserEvent(events, awaitingAskUser);
  const showInline =
    status !== 'submitted' &&
    pending !== null &&
    pending.id === promptEventId &&
    pending.status !== 'submitted';
  const questionCount = payload.questions.length;

  return (
    <section
      className={cn(
        'vyotiq-stepfade-once vx-ask-user-inline rounded-inner border border-border-subtle/40 bg-surface-raised/30 px-3 py-2.5',
        showInline && 'vx-ask-user-inline--open'
      )}
      data-row-kind="ask-user-prompt"
      aria-label={title}
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-row font-medium text-text-primary">{title}</p>
        {showInline && questionCount > 1 ? (
          <span className="shrink-0 font-mono text-meta text-text-faint tabular-nums">
            {questionCount} questions
          </span>
        ) : null}
      </div>
      {showInline && pending ? (
        <div className="mt-2.5">
          <AskUserForm pending={pending} variant="inline" />
        </div>
      ) : !showInline && status !== 'submitted' ? (
        <p className="mt-1 text-meta text-text-faint">Waiting for your response…</p>
      ) : null}
      <span className="sr-only">{displayText}</span>
    </section>
  );
}
