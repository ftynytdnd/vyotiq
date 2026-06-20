/**
 * Single source for ask_user UI copy (composer, status strip, timeline).
 */

import type { AskUserStructuredPayload } from '../types/askUser.js';
import { shouldUseAskUserOverlay } from './askUserOverlay.js';

export const ASK_USER_REPLY_NEEDED = 'Reply needed';
export const ASK_USER_SUBMIT_LABEL = 'Submit answers';
export const ASK_USER_QUEUE_DEFERRAL = 'Queue defers until you reply';

/** Composer field during ask_user — supplement only; primary answers live in the form. */
export const ASK_USER_COMPOSER_PLACEHOLDER = 'Optional prose or attachments…';

export const ASK_USER_HOST_GATE_SUBTITLE =
  'Uses agent tokens only if you choose Yes — No completes the run immediately';

export function resolveAskUserTitle(payload: AskUserStructuredPayload): string {
  return payload.title?.trim() || 'Clarifying questions';
}

export function resolveAskUserPlacement(input: {
  source?: 'host-report-gate';
  payload: AskUserStructuredPayload;
}): 'overlay' | 'inline' {
  return shouldUseAskUserOverlay(input) ? 'overlay' : 'inline';
}

/** Status-strip detail after "Reply needed —". Omit when overlay is open (form is self-explanatory). */
export function resolveAskUserStatusDetail(input: {
  source?: 'host-report-gate';
  payload: AskUserStructuredPayload;
}): string | null {
  const placement = resolveAskUserPlacement(input);
  if (placement === 'overlay') return null;

  const title = resolveAskUserTitle(input.payload);
  if (title === 'Clarifying questions') {
    return 'Answer in the card above, or type here and press Submit answers';
  }
  return `Answer in "${title}" above, or type here and press Submit answers`;
}

export function formatAskUserAnsweredProgress(answered: number, total: number): string {
  return `${answered}/${total} answered`;
}
