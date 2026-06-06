/**
 * Reports IPC — in-app HTML report browser.
 */

import { shell } from 'electron';
import { IPC } from '@shared/constants.js';
import type { ReportsOpenInput } from '@shared/types/ipc.js';
import { realpathInsideWorkspace } from '../tools/sandbox.js';
import {
  requireWorkspace,
  requireWorkspaceById
} from '../workspace/workspaceState.js';
import { openReportInAppBrowser } from '../window/reportBrowserWindow.js';
import { logger } from '../logging/logger.js';
import { wrapIpcHandler } from './wrapIpcHandler.js';
import {
  assertObject,
  assertOptionalString,
  assertString
} from './validate.js';

const log = logger.child('ipc/reports');

const MAX_RELATIVE_PATH_BYTES = 4096;

export function registerReportsIpc(): void {
  wrapIpcHandler(IPC.REPORTS_OPEN, async (_event, input: ReportsOpenInput) => {
    assertObject('reports:open', 'input', input);
    assertString('reports:open', 'relPath', input.relPath, { maxBytes: MAX_RELATIVE_PATH_BYTES });
    assertOptionalString('reports:open', 'workspaceId', input.workspaceId);
    if (input.title !== undefined) {
      assertString('reports:open', 'title', input.title, { maxBytes: 256 });
    }

    const ws = input.workspaceId
      ? await requireWorkspaceById(input.workspaceId)
      : await requireWorkspace();

    let abs: string;
    try {
      abs = await realpathInsideWorkspace(ws, input.relPath);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('refused to open report outside workspace', { relPath: input.relPath, err: msg });
      return { ok: false as const, error: msg };
    }

    try {
      await openReportInAppBrowser(abs, { title: input.title });
      return { ok: true as const };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('in-app report open failed; falling back to shell.openPath', {
        relPath: input.relPath,
        err: msg
      });
      const result = await shell.openPath(abs);
      if (result) {
        return { ok: false as const, error: result };
      }
      return { ok: true as const };
    }
  });
}
