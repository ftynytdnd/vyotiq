/** Composer placeholder copy — landing, active run, ask_user, and follow-up lanes. */

import { ASK_USER_COMPOSER_PLACEHOLDER, ASK_USER_QUEUE_DEFERRAL } from '@shared/askUser/askUserCopy.js';

export const COMPOSER_LANDING_PLACEHOLDER =
  '@ files or / skills — describe what Agent V should work on…';

export const COMPOSER_DRAFT_PLACEHOLDER =
  'Unsent draft — continue editing or send when ready…';

export const COMPOSER_DEFAULT_PLACEHOLDER = '@ files or / skills — describe your task…';

/** Active run — Send/Queue guidance lives in the status strip. */
export const COMPOSER_PROCESSING_PLACEHOLDER = '@ files or / skills…';

/** Shown in the chip-row status strip while a run is active. */
export const COMPOSER_PROCESSING_RUN_HINT =
  'Send steers mid-run · Queue before finish';

/** ask_user pause — composer is for optional supplement text only. */
export const COMPOSER_ASK_USER_PLACEHOLDER = `${ASK_USER_COMPOSER_PLACEHOLDER} · ${ASK_USER_QUEUE_DEFERRAL}…`;

/** Queued follow-up open in the composer for in-place edit. */
export const COMPOSER_EDIT_QUEUED_PLACEHOLDER =
  'Editing queued follow-up — Enter or Save to apply…';

export function resolveComposerPlaceholder(opts: {
  landing: boolean;
  storeDraft: string;
  editorPlain: string;
  eventsLength: number;
  isProcessing?: boolean;
  needsAskUserReply?: boolean;
  editingQueued?: boolean;
}): string {
  if (opts.editingQueued) return COMPOSER_EDIT_QUEUED_PLACEHOLDER;
  if (opts.needsAskUserReply) return COMPOSER_ASK_USER_PLACEHOLDER;
  if (opts.isProcessing) return COMPOSER_PROCESSING_PLACEHOLDER;

  if (!opts.landing) return COMPOSER_DEFAULT_PLACEHOLDER;

  const hasUnsentDraft =
    Boolean(opts.storeDraft.trim()) && opts.eventsLength === 0 && !opts.editorPlain.trim();
  return hasUnsentDraft ? COMPOSER_DRAFT_PLACEHOLDER : COMPOSER_LANDING_PLACEHOLDER;
}
