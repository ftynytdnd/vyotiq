/**
 * Floating `ask_user` overlay — anchored above the composer via
 * {@link ComposerDialogPortal}. Non-blocking: no backdrop, no focus trap.
 */

import { useEffect } from 'react';
import { cn } from '../../../lib/cn.js';
import { useAskUserDraftStore } from '../../../store/askUserDraft.js';
import { useChatStore } from '../../../store/useChatStore.js';
import { appComposerShellClassName } from '../../ui/SurfaceShell.js';
import type { PendingAskUserEvent } from '../../../lib/pendingAskUser.js';

interface AskUserOverlayProps {
  pending: PendingAskUserEvent;
}

export function AskUserOverlay({ pending }: AskUserOverlayProps) {
  const payload = pending.payload;
  const ensureDraft = useAskUserDraftStore((s) => s.ensureDraft);
  const drafts = useAskUserDraftStore((s) => s.byPromptId[pending.id]);
  const toggleOption = useAskUserDraftStore((s) => s.toggleOption);
  const skipQuestion = useAskUserDraftStore((s) => s.skipQuestion);
  const setFreeText = useAskUserDraftStore((s) => s.setFreeText);
  const hasAnyAnswer = useAskUserDraftStore((s) => s.hasAnyAnswer);
  const composerDraft = useChatStore((s) => s.draft) ?? '';
  const submitPendingAskUser = useChatStore((s) => s.submitPendingAskUser);
  const isProcessing = useChatStore((s) => s.isProcessing);

  useEffect(() => {
    ensureDraft(pending.id, payload);
  }, [ensureDraft, pending.id, payload]);

  const sheet = drafts ?? {};
  const canSubmit = hasAnyAnswer(pending.id, payload, composerDraft);

  const handleSubmit = () => {
    if (!canSubmit || isProcessing) return;
    void submitPendingAskUser({ supplementText: composerDraft.trim() || undefined });
  };

  return (
    <div
      className={cn(
        'vx-composer-dialog vx-ask-user-overlay vyotiq-composer-dialog-enter mb-2 flex max-h-[min(50vh,24rem)] flex-col',
        appComposerShellClassName
      )}
      role="form"
      aria-label={payload.title ?? 'Clarifying questions'}
      data-ask-user-overlay
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border-subtle/30 px-3 py-2">
        <div className="min-w-0">
          <p className="text-row font-medium text-text-primary">
            {payload.title?.trim() || 'Your input needed'}
          </p>
          <p className="text-meta text-text-faint">
            Reply here or type in the composer and press Send
          </p>
        </div>
        <span className="shrink-0 font-mono text-meta text-accent tabular-nums">
          {payload.questions.length}Q
        </span>
      </header>
      <div className="scrollbar-stealth min-h-0 flex-1 overflow-y-auto px-3 py-2">
        <div className="flex flex-col gap-3">
          {payload.questions.map((q) => {
            const d = sheet[q.id] ?? { skipped: false, selected: new Set<string>(), freeText: '' };
            const allowMultiple = q.allow_multiple === true;
            return (
              <div
                key={q.id}
                className={cn(
                  'min-w-0 rounded-inner border border-border-subtle/40 px-2.5 py-2',
                  d.skipped && 'opacity-60'
                )}
              >
                <div className="mb-1.5 flex items-start justify-between gap-2">
                  <p className="text-row text-text-secondary">{q.prompt}</p>
                  <button
                    type="button"
                    onClick={() => skipQuestion(pending.id, q.id)}
                    className="shrink-0 font-mono text-meta text-text-faint hover:text-text-secondary"
                  >
                    Skip
                  </button>
                </div>
                {d.skipped ? (
                  <p className="font-mono text-meta text-text-faint italic">Skipped</p>
                ) : (
                  <>
                    {q.options.length > 0 ? (
                      <ul className="mb-2 flex flex-col gap-1">
                        {q.options.map((opt) => {
                          const selected = d.selected.has(opt.id);
                          return (
                            <li key={opt.id}>
                              <button
                                type="button"
                                onClick={() =>
                                  toggleOption(pending.id, q.id, opt.id, allowMultiple)
                                }
                                className={cn(
                                  'flex w-full items-start gap-2 rounded-inner border px-2.5 py-1.5 text-left text-meta transition-colors',
                                  selected
                                    ? 'border-accent/50 bg-accent-soft/30 text-text-primary'
                                    : 'border-border-subtle/50 bg-transparent text-text-secondary hover:border-border-subtle hover:bg-chrome-hover-soft'
                                )}
                                aria-pressed={selected}
                              >
                                <span
                                  className={cn(
                                    'mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center border font-mono text-[10px]',
                                    allowMultiple ? 'rounded-sm' : 'rounded-full',
                                    selected
                                      ? 'border-accent bg-accent text-accent-foreground'
                                      : 'border-border-subtle text-transparent'
                                  )}
                                  aria-hidden
                                >
                                  {allowMultiple ? '✓' : '•'}
                                </span>
                                <span className="min-w-0 flex-1">{opt.label}</span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                    <input
                      type="text"
                      value={d.freeText}
                      onChange={(e) => setFreeText(pending.id, q.id, e.target.value)}
                      placeholder={
                        q.options.length > 0 ? 'Or type your own answer…' : 'Your answer…'
                      }
                      className={cn(
                        'w-full rounded-inner border border-border-subtle/50 bg-surface px-2.5 py-1.5',
                        'font-mono text-meta text-text-primary placeholder:text-text-faint',
                        'focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/20'
                      )}
                    />
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
      <footer className="flex shrink-0 justify-end gap-2 border-t border-border-subtle/30 px-3 py-2">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit || isProcessing}
          className={cn(
            'rounded-inner px-3 py-1.5 font-mono text-meta font-medium transition-colors',
            canSubmit && !isProcessing
              ? 'bg-accent text-accent-foreground hover:bg-accent/90'
              : 'cursor-not-allowed bg-surface-raised text-text-faint'
          )}
        >
          {isProcessing ? 'Submitting…' : 'Submit answers'}
        </button>
      </footer>
    </div>
  );
}
