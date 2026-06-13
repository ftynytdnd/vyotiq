/**
 * `openWorkspaceFile` — single helper used everywhere the renderer
 * hands a workspace-relative path off to the OS default opener or the
 * in-app report BrowserWindow.
 */

import { isEditableTextFile } from '@shared/text/isEditableTextFile.js';
import { vyotiq } from './ipc.js';
import { logger } from './logger.js';
import { openWorkspaceFileInEditor } from './openWorkspaceFileInEditor.js';
import { useToastStore } from '../store/useToastStore.js';
import { useSettingsStore } from '../store/useSettingsStore.js';
import { resolveReportsSettings } from '@shared/report/reportsSettings.js';

const log = logger.child('lib/openPath');

function isReportArtifactPath(filePath: string): boolean {
  const norm = filePath.replace(/\\/g, '/').replace(/^\.\//, '');
  return norm.includes('.vyotiq/reports/');
}

export interface OpenWorkspaceFileOpts {
  workspaceId?: string;
  /** Short tag for log lines (`'report'`, …). */
  context?: string;
  /** When `'report'`, respects `settings.ui.reports.openInAppBrowser`. */
  kind?: 'report' | 'default';
  /** Optional title for the in-app report window. */
  title?: string;
  /** When true, skip the in-app editor even for text files. */
  forceExternal?: boolean;
}

/**
 * Open a workspace-relative path in the in-app report browser or OS opener.
 *
 * @returns `true` on success, `false` on failure (after logging + toast).
 */
export async function openWorkspaceFile(
  filePath: string,
  opts: OpenWorkspaceFileOpts = {}
): Promise<boolean> {
  const reports = resolveReportsSettings(useSettingsStore.getState().settings.ui);
  const useInApp =
    opts.kind === 'report' && reports.openInAppBrowser !== false;

  if (
    !useInApp &&
    !opts.forceExternal &&
    !isReportArtifactPath(filePath) &&
    isEditableTextFile(filePath)
  ) {
    const opened = await openWorkspaceFileInEditor(filePath, {
      ...(opts.workspaceId ? { workspaceId: opts.workspaceId } : {})
    });
    if (opened) return true;
  }

  try {
    if (useInApp) {
      const reply = await vyotiq.reports.open({
        relPath: filePath,
        workspaceId: opts.workspaceId,
        title: opts.title
      });
      if (!reply.ok) {
        throw new Error(reply.error);
      }
    } else {
      await vyotiq.tools.openPath(filePath, opts.workspaceId);
    }
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn('openPath failed', {
      filePath,
      workspaceId: opts.workspaceId,
      context: opts.context,
      inApp: useInApp,
      err: msg
    });
    useToastStore.getState().show(
      `Could not open ${filePath}: ${msg}`,
      'danger'
    );
    return false;
  }
}
