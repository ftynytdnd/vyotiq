/**
 * `openWorkspaceFile` — single helper used everywhere the renderer
 * hands a workspace-relative path off to the OS default opener.
 *
 * Collapses near-identical try/catch + log + (toast) snippets that
 * previously lived in multiple report-open call sites. Each had
 * drifted in subtle ways (some toasted, some only logged, some
 * captured the workspace id, some did not). This helper standardises:
 *
 *   1. Optional `workspaceId` is forwarded to the IPC so the path is
 *      resolved against the file's owning workspace, not the active
 *      one — fixes cross-workspace mis-resolution when the user has
 *      flipped to a different workspace since the artifact was written.
 *   2. Failures surface as a danger toast AND a structured warn-level
 *      log line. Callers no longer have to remember to wire either.
 *   3. Returns `true` on success, `false` on failure, so callers that
 *      gate UI state on the open (e.g. flipping a busy flag) have a
 *      single boolean to read instead of try/catch boilerplate.
 */

import { vyotiq } from './ipc.js';
import { logger } from './logger.js';
import { useToastStore } from '../store/useToastStore.js';

const log = logger.child('lib/openPath');

/**
 * Open a workspace-relative path in the OS default opener.
 *
 * @param filePath workspace-relative path (e.g. `.vyotiq/reports/foo-20260101-120000.html`).
 * @param opts.workspaceId — pin the resolution to this workspace.
 *   Required-in-spirit whenever the caller knows the owner; falling
 *   back to the active workspace works only in single-workspace
 *   setups.
 * @param opts.context — short tag attached to the log line (`'report'`,
 *   …) so debugging which call path failed is one log query away.
 * @returns `true` on success, `false` on any failure (after logging +
 *   toasting).
 */
export async function openWorkspaceFile(
  filePath: string,
  opts: { workspaceId?: string; context?: string } = {}
): Promise<boolean> {
  try {
    await vyotiq.tools.openPath(filePath, opts.workspaceId);
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn('openPath failed', {
      filePath,
      workspaceId: opts.workspaceId,
      context: opts.context,
      err: msg
    });
    useToastStore.getState().show(
      `Could not open ${filePath}: ${msg}`,
      'danger'
    );
    return false;
  }
}
