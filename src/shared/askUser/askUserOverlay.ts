/**
 * When agent `ask_user` prompts exceed this count, the composer overlay is used
 * instead of an inline timeline form (scrollable, sticky submit).
 */

import type { AskUserStructuredPayload } from '../types/askUser.js';

export const ASK_USER_OVERLAY_MIN_QUESTIONS = 3;

export function shouldUseAskUserOverlay(input: {
  source?: 'host-report-gate';
  payload: AskUserStructuredPayload;
}): boolean {
  if (input.source === 'host-report-gate') return true;
  return input.payload.questions.length >= ASK_USER_OVERLAY_MIN_QUESTIONS;
}
