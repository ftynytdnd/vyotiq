/**
 * Compact timeline anchor for `ask_user` — full UI in the composer overlay.
 */

import type { AskUserStructuredPayload } from '@shared/types/askUser.js';
interface AskUserCompactRowProps {
  payload: AskUserStructuredPayload;
  displayText: string;
  status?: 'pending' | 'submitted';
}

export function AskUserCompactRow({ payload, displayText, status }: AskUserCompactRowProps) {
  const submitted = status === 'submitted';
  const qCount = payload.questions.length;
  const title = payload.title?.trim() || 'Clarifying questions';

  return (
    <section
      className="vyotiq-stepfade-once rounded-inner bg-surface-raised/40 px-3 py-2"
      data-row-kind="ask-user-prompt"
      aria-label={title}
    >
      <p className="text-row font-medium text-text-primary">
        {submitted ? 'Answers submitted' : title}
      </p>
      {!submitted ? (
        <p className="mt-1 text-meta text-text-faint">
          {qCount} question{qCount === 1 ? '' : 's'} — use the panel above the composer
        </p>
      ) : null}
      <span className="sr-only">{displayText}</span>
    </section>
  );
}
