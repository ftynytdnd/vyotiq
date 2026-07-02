/**
 * Workspace-scoped git subprocess runner — GitHub token auth or system credentials.
 */

import { runGitPlain, runGitWithToken } from '../github/gitRunner.js';
import { getGitHubAccountWithToken } from '../github/githubAccountsStore.js';
import type { WorkspaceEntry } from '@shared/types/ipc.js';
import { GitUserError } from './gitUserError.js';
import { emitWorkspaceTreeChanged } from './workspaceTreeWatcher.js';

const GIT_TIMEOUT_MS = 120_000;

export type WorkspaceGitRun = (args: string[]) => Promise<string>;

export async function createWorkspaceGitRunner(
  wsPath: string,
  entry?: WorkspaceEntry | null
): Promise<WorkspaceGitRun> {
  if (entry?.github) {
    const account = await getGitHubAccountWithToken(entry.github.accountId);
    if (!account) {
      throw new GitUserError(
        'GitHub account disconnected. Reconnect in Settings → Workspace data.'
      );
    }
    const host = entry.github.host;
    const token = account.token;
    return (args: string[]) =>
      runGitWithToken(token, host, ['-C', wsPath, ...args], { timeoutMs: GIT_TIMEOUT_MS });
  }
  return (args: string[]) =>
    runGitPlain(['-C', wsPath, ...args], { timeoutMs: GIT_TIMEOUT_MS });
}

export function notifyWorkspaceGitChanged(workspaceId: string): void {
  emitWorkspaceTreeChanged(workspaceId);
}
