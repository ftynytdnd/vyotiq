/**
 * User-facing orchestrator error / retry copy helpers.
 */

import { MAX_SELF_CORRECTION_ATTEMPTS } from '@shared/constants.js';

/** Ensure a single sentence terminator without doubling punctuation. */
export function sentenceEnd(msg: string): string {
  const t = msg.trimEnd();
  if (!t) return '';
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

export function formatRetryThought(
  msg: string,
  attempt: number,
  max: number = MAX_SELF_CORRECTION_ATTEMPTS
): string {
  return `LLM call failed (attempt ${attempt}/${max}): ${sentenceEnd(msg)} Retrying.`;
}

export function formatProviderStrikeError(consecutiveErrors: number, detail: string): string {
  const core = sentenceEnd(detail);
  return (
    `The provider failed ${consecutiveErrors} times in a row (${core}) ` +
    'Try Retry below, check API settings, or switch models.'
  );
}

export function formatToolStrikeError(lastFailure?: string): string {
  const base = `Tools failed ${MAX_SELF_CORRECTION_ATTEMPTS} times in a row.`;
  const tail = 'Try Retry below, review the errors above, or adjust your request.';
  if (!lastFailure?.trim()) return `${base} ${tail}`;
  return `${base} Last error: ${sentenceEnd(lastFailure)} ${tail}`;
}

export const RUN_STOPPED_THOUGHT = 'Run stopped.';
