/**
 * `safeCopy` — single helper used wherever the renderer writes text
 * to the OS clipboard.
 *
 * Centralises three responsibilities that drifted across the
 * timeline / pending-changes copy buttons:
 *
 *   1. Catch the `navigator.clipboard.writeText` rejection. The
 *      Clipboard API rejects in several real-world cases (user denied
 *      permission, document not focused under certain Electron
 *      lifecycle moments, locked-down environments). Pre-helper, each
 *      call site used `void navigator.clipboard.writeText(…).then(…)`
 *      with no `.catch`, so failures surfaced as DevTools-only
 *      `Uncaught (in promise) NotAllowedError` rows that the user
 *      never saw — they just got no feedback when "Copy" silently
 *      failed.
 *   2. Fall back to a `document.execCommand('copy')` round through a
 *      hidden `<textarea>` when the Clipboard API is missing. Mirrors
 *      the prior DiffCopyButton fallback so a Clipboard-API-less
 *      runtime (older Electron, certain enterprise lockdowns) still
 *      copies.
 *   3. Surface a `danger` toast on terminal failure so the user sees
 *      WHY the copy didn't happen instead of staring at an unchanged
 *      icon. Same surface `openWorkspaceFile` uses for IPC failures.
 *
 * Returns a boolean so the caller's UI can flip its "Copied" state
 * only on real success — without this, a failed write would still
 * paint the green check for 1.2 s and lie to the user.
 *
 * Callers strip emoji (or any other display sanitiser) BEFORE
 * invoking `safeCopy`. The helper is intentionally unopinionated
 * about what it ships to the clipboard — different surfaces have
 * different policies (raw diff text vs. emoji-free assistant prose
 * vs. unchanged user prompt) and folding the strip in here would
 * either over- or under-strip at half the sites.
 */

import { logger } from './logger.js';
import { useToastStore } from '../store/useToastStore.js';

const log = logger.child('lib/clipboard');

/**
 * Copy `text` to the OS clipboard.
 *
 * @param text  The string to ship to the clipboard.
 * @param opts.context  Optional short tag attached to the log line
 *   (`'assistant-row'`, `'tool-row'`, …) so triage can identify the
 *   failing call path without combing the stack.
 * @param opts.toastOnFailure  When `false`, suppresses the danger
 *   toast and only logs. Defaults to `true` (the user-visible
 *   contract for the common copy-button case). The opt-out exists
 *   for diagnostic / programmatic copy paths where a toast would be
 *   noise.
 * @returns `true` on success, `false` on any failure (after logging
 *   and — by default — toasting).
 */
export async function safeCopy(
  text: string,
  opts: { context?: string; toastOnFailure?: boolean } = {}
): Promise<boolean> {
  // Empty-string fast path: nothing to copy, no error to surface. The
  // call sites already guard for this in most cases, but a defensive
  // check here keeps the helper's contract honest.
  if (text.length === 0) return false;

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    // Legacy fallback. `document.execCommand('copy')` is deprecated
    // but still functional in every current Electron runtime. The
    // hidden textarea trick is the canonical recipe; we mirror the
    // exact shape `DiffCopyButton` used before this helper landed.
    if (typeof document !== 'undefined') {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      ta.setAttribute('readonly', '');
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } finally {
        document.body.removeChild(ta);
      }
      if (ok) return true;
    }
    throw new Error('clipboard unavailable');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn('clipboard write failed', {
      context: opts.context,
      err: msg
    });
    if (opts.toastOnFailure !== false) {
      useToastStore.getState().show(
        `Could not copy to clipboard: ${msg}`,
        'danger'
      );
    }
    return false;
  }
}
