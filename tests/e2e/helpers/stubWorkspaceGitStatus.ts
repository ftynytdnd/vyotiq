/**
 * Stub workspace git-status IPC for landing / branch chip E2E.
 */

import type { ElectronApplication } from '@playwright/test';
import type { WorkspaceGitContext } from '../../../src/shared/types/ipc.js';

export async function stubWorkspaceGitStatus(
  electronApp: ElectronApplication,
  context: WorkspaceGitContext
): Promise<void> {
  await electronApp.evaluate(async ({ ipcMain }, ctx) => {
    const channel = 'workspace:git-status';
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async () => ({
      paths: {},
      staged: {},
      unstaged: {},
      entries: {},
      context: ctx
    }));
  }, context);
}
