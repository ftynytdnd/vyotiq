/** Composer placeholder copy for landing vs active chat. */

export const COMPOSER_LANDING_PLACEHOLDER =
  '@ to mention files, or describe what Agent V should work on…';

export const COMPOSER_DRAFT_PLACEHOLDER =
  'Unsent draft — continue editing or send when ready…';

export const COMPOSER_DEFAULT_PLACEHOLDER = '@ to mention files, or describe your task…';

export function resolveComposerPlaceholder(opts: {
  landing: boolean;
  storeDraft: string;
  editorPlain: string;
  eventsLength: number;
}): string {
  if (!opts.landing) return COMPOSER_DEFAULT_PLACEHOLDER;
  const hasUnsentDraft =
    Boolean(opts.storeDraft.trim()) && opts.eventsLength === 0 && !opts.editorPlain.trim();
  return hasUnsentDraft ? COMPOSER_DRAFT_PLACEHOLDER : COMPOSER_LANDING_PLACEHOLDER;
}
