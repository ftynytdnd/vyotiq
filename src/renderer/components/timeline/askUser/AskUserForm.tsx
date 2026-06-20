/**
 * Inline ask_user form — shared by timeline row and host-gate overlay.
 */

import { useEffect, type FormEvent, type KeyboardEvent } from 'react';
import {
  ASK_USER_HOST_GATE_SUBTITLE,
  ASK_USER_SUBMIT_LABEL,
  formatAskUserAnsweredProgress,
  resolveAskUserTitle
} from '@shared/askUser/askUserCopy.js';
import { cn } from '../../../lib/cn.js';
import { useAskUserDraftStore } from '../../../store/askUserDraft.js';
import { useChatStore } from '../../../store/useChatStore.js';
import type { PendingAskUserEvent } from '../../../lib/pendingAskUser.js';
import { AskUserCustomAnswer } from './AskUserCustomAnswer.js';
import { AskUserOptionButton } from './AskUserOptionButton.js';

interface AskUserFormProps {
  pending: PendingAskUserEvent;
  /** Inline timeline variant vs floating overlay chrome. */
  variant?: 'inline' | 'overlay';
}

export function AskUserForm({ pending, variant = 'inline' }: AskUserFormProps) {
  const payload = pending.payload;
  const ensureDraft = useAskUserDraftStore((s) => s.ensureDraft);
  const drafts = useAskUserDraftStore((s) => s.byPromptId[pending.id]);
  const toggleOption = useAskUserDraftStore((s) => s.toggleOption);
  const skipQuestion = useAskUserDraftStore((s) => s.skipQuestion);
  const setFreeText = useAskUserDraftStore((s) => s.setFreeText);
  const hasAnyAnswer = useAskUserDraftStore((s) => s.hasAnyAnswer);
  const countAnswered = useAskUserDraftStore((s) => s.countAnswered);
  const composerDraft = useChatStore((s) => s.draft) ?? '';
  const submitPendingAskUser = useChatStore((s) => s.submitPendingAskUser);
  const isProcessing = useChatStore((s) => s.isProcessing);

  useEffect(() => {
    ensureDraft(pending.id, payload);
  }, [ensureDraft, pending.id, payload]);

  const isHostGate = pending.source === 'host-report-gate';
  const sheet = drafts ?? {};
  const canSubmit = hasAnyAnswer(pending.id, payload, composerDraft);
  const inline = variant === 'inline';
  const questionCount = payload.questions.length;

  const handleSubmit = () => {
    if (!canSubmit || isProcessing) return;
    void submitPendingAskUser({ supplementText: composerDraft.trim() || undefined });
  };

  const onFormKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.tagName === 'TEXTAREA') return;
    e.preventDefault();
    handleSubmit();
  };

  const onFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    handleSubmit();
  };

  return (
    <form
      className={cn(
        'vx-ask-user-form flex flex-col',
        inline ? 'vx-ask-user-form--inline' : 'max-h-[min(50vh,24rem)]'
      )}
      data-ask-user-form
      onSubmit={onFormSubmit}
      onKeyDown={onFormKeyDown}
    >
      {!inline ? (
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border-subtle/30 px-3 py-2">
          <div className="min-w-0">
            <div className="mb-0.5 flex flex-wrap items-center gap-2">
              {isHostGate ? (
                <span className="rounded-inner border border-accent/30 bg-accent-soft/40 px-1.5 py-0.5 font-mono text-meta text-accent">
                  Vyotiq
                </span>
              ) : null}
              <p className="text-row font-medium text-text-primary">
                {resolveAskUserTitle(payload)}
              </p>
            </div>
            {isHostGate ? (
              <p className="text-meta text-text-faint">{ASK_USER_HOST_GATE_SUBTITLE}</p>
            ) : null}
          </div>
          {!isHostGate && questionCount > 1 ? (
            <span className="shrink-0 font-mono text-meta text-accent tabular-nums">
              {formatAskUserAnsweredProgress(countAnswered(pending.id, payload), questionCount)}
            </span>
          ) : null}
        </header>
      ) : null}

      <div
        className={cn(
          'scrollbar-stealth min-h-0 flex-1 overflow-y-auto',
          inline ? 'px-0 py-0.5' : 'px-3 py-2'
        )}
      >
        <div className={cn('flex flex-col gap-2.5', isHostGate && 'vx-ask-user-host-gate-options')}>
          {payload.questions.map((q, index) => {
            const d = sheet[q.id] ?? { skipped: false, selected: new Set<string>(), freeText: '' };
            const allowMultiple = q.allow_multiple === true;
            return (
              <div
                key={q.id}
                className={cn(
                  'min-w-0',
                  !inline && 'rounded-inner border border-border-subtle/40 px-2.5 py-2',
                  d.skipped && 'opacity-60',
                  isHostGate && 'border-border-subtle/25 bg-chrome-hover-soft/20'
                )}
              >
                <div className="mb-1.5 flex items-start justify-between gap-2">
                  <p className="text-row text-text-secondary">
                    {questionCount > 1 ? (
                      <span className="mr-1.5 font-mono text-meta text-text-faint tabular-nums">
                        {index + 1}.
                      </span>
                    ) : null}
                    {q.prompt}
                  </p>
                  {!isHostGate ? (
                    <button
                      type="button"
                      onClick={() => skipQuestion(pending.id, q.id)}
                      className="shrink-0 font-mono text-meta text-text-faint hover:text-text-secondary"
                    >
                      Skip
                    </button>
                  ) : null}
                </div>
                {d.skipped ? (
                  <p className="font-mono text-meta text-text-faint italic">Skipped</p>
                ) : (
                  <>
                    <ul className="flex flex-col gap-1">
                      {q.options.map((opt) => {
                        const selected = d.selected.has(opt.id);
                        return (
                          <li key={opt.id}>
                            <AskUserOptionButton
                              selected={selected}
                              allowMultiple={allowMultiple}
                              onClick={() => toggleOption(pending.id, q.id, opt.id, allowMultiple)}
                            >
                              {opt.label}
                            </AskUserOptionButton>
                          </li>
                        );
                      })}
                      {!isHostGate ? (
                        <li>
                          <AskUserCustomAnswer
                            value={d.freeText}
                            allowMultiple={allowMultiple}
                            placeholder={
                              q.options.length > 0 ? 'Or type your own answer…' : 'Your answer…'
                            }
                            onChange={(text) => setFreeText(pending.id, q.id, text, allowMultiple)}
                          />
                        </li>
                      ) : null}
                    </ul>
                    {allowMultiple && q.options.length > 0 ? (
                      <p className="mt-1 font-mono text-chat-meta text-text-faint">
                        Select one or more
                      </p>
                    ) : null}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <footer
        className={cn(
          'flex shrink-0 items-center justify-end gap-2',
          inline ? 'pt-2' : 'border-t border-border-subtle/30 px-3 py-2'
        )}
      >
        {!inline && questionCount > 1 ? (
          <p className="mr-auto font-mono text-chat-meta text-text-faint tabular-nums">
            {formatAskUserAnsweredProgress(countAnswered(pending.id, payload), questionCount)}
          </p>
        ) : inline ? (
          <p className="mr-auto hidden font-mono text-chat-meta text-text-faint sm:block">
            Enter to submit
          </p>
        ) : null}
        <button
          type="submit"
          disabled={!canSubmit || isProcessing}
          className={cn(
            'rounded-inner px-3 py-1.5 font-mono text-meta font-medium transition-colors',
            canSubmit && !isProcessing
              ? 'bg-accent text-text-primary hover:bg-chrome-hover'
              : 'cursor-not-allowed bg-surface-raised text-text-faint'
          )}
        >
          {isProcessing ? 'Submitting…' : isHostGate ? 'Continue' : ASK_USER_SUBMIT_LABEL}
        </button>
      </footer>
    </form>
  );
}
