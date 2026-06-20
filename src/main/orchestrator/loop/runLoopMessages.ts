/**
 * User-facing orchestrator error / retry copy helpers.
 */

import { MAX_SELF_CORRECTION_ATTEMPTS } from '@shared/constants.js';
import { formatPiiOrModerationHint } from '../../providers/providerError.js';

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
  const piiHint = formatPiiOrModerationHint(msg);
  const base = `LLM call failed (attempt ${attempt}/${max}): ${sentenceEnd(msg)} Retrying.`;
  return piiHint ? `${base} ${piiHint}` : base;
}

export function formatProviderStrikeError(consecutiveErrors: number, detail: string): string {
  const core = sentenceEnd(detail);
  const piiHint = formatPiiOrModerationHint(detail);
  const base =
    `The provider failed ${consecutiveErrors} times in a row (${core}) ` +
    'Try Retry below, check API settings, or switch models.';
  return piiHint ? `${base} ${piiHint}` : base;
}

export function formatToolStrikeError(
  lastFailure?: string,
  rootFailure?: string
): string {
  const base = `Tools failed ${MAX_SELF_CORRECTION_ATTEMPTS} times in a row.`;
  const tail = 'Try Retry below, review the errors above, or adjust your request.';
  const last = lastFailure?.trim();
  const root = rootFailure?.trim();
  if (root && last && root !== last) {
    return (
      `${base} Root cause: ${sentenceEnd(root)} Last error: ${sentenceEnd(last)} ${tail}`
    );
  }
  if (last) return `${base} Last error: ${sentenceEnd(last)} ${tail}`;
  return `${base} ${tail}`;
}

/** Harness-driven recovery copy — run continues after sustained tool failures. */
function buildToolRecoveryHints(lastFailure?: string, rootFailure?: string): string {
  const combined = `${rootFailure ?? ''} ${lastFailure ?? ''}`.toLowerCase();
  const hints: string[] = [];

  if (combined.includes('timed out')) {
    hints.push(
      'For slow build/test/install, rerun bash with a higher timeoutMs (up to 30 min) and shared:false — do not probe outside the workspace.'
    );
  }
  if (combined.includes('workspace escape')) {
    hints.push(
      'Stay inside the workspace: use relative paths, `read`/`ls` for project files, and `ask_user` for host paths — never `../`, drive letters, `$env:USERPROFILE`, or `~`.'
    );
  }
  if (combined.includes('powershell syntax') || combined.includes(' rejects `&`')) {
    hints.push('On Windows PowerShell, chain commands with `;` not `&`.');
  }
  if (combined.includes('long-running server')) {
    hints.push('Do not start dev servers in bash — probe with curl/Invoke-RestMethod or ask the user to start the service.');
  }
  if (hints.length === 0) {
    hints.push(
      'Re-read affected files with `read` before `edit`. Run `ls` to verify paths. Use `ask_user` if blocked.'
    );
  }
  return hints.join(' ');
}

export function formatToolRecoveryThought(
  strikeCount: number,
  lastFailure?: string,
  rootFailure?: string
): string {
  const last = lastFailure?.trim();
  const root = rootFailure?.trim();
  const detail =
    root && last && root !== last
      ? `Root: ${sentenceEnd(root)} Latest: ${sentenceEnd(last)}`
      : last
        ? sentenceEnd(last)
        : 'Repeated tool failures.';
  return (
    `Tool recovery (${strikeCount} failed rounds): ${detail} ${buildToolRecoveryHints(lastFailure, rootFailure)}`
  );
}

/** Harness-driven recovery when the provider keeps failing — run continues. */
export function formatProviderRecoveryThought(consecutiveErrors: number, detail: string): string {
  const piiHint = formatPiiOrModerationHint(detail);
  const base =
    `Provider recovery (${consecutiveErrors} failures): ${sentenceEnd(detail)} ` +
    'Check network and API settings, switch models, or use `ask_user` if this persists.';
  return piiHint ? `${base} ${piiHint}` : base;
}

export const RUN_STOPPED_THOUGHT = 'Run stopped.';

export function formatRunTokenBudgetError(cumulativeTotal: number, maxTotalTokens: number): string {
  const fmt = (n: number) => n.toLocaleString('en-US');
  return (
    `This run exceeded the configured token budget (${fmt(cumulativeTotal)} / ` +
    `${fmt(maxTotalTokens)} total tokens). Start a new message to continue.`
  );
}

export function formatRunWallClockBudgetError(
  settings: { runWallClockBudget: { maxDurationMs: number } }
): string {
  const minutes = Math.round(settings.runWallClockBudget.maxDurationMs / 60_000);
  return (
    `This run exceeded the configured wall-clock budget (${minutes} minute` +
    `${minutes === 1 ? '' : 's'}). Start a new message to continue.`
  );
}
