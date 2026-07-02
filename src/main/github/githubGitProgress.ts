/**
 * Push git clone/fetch progress to the renderer (toast + branch chip).
 */

import { IPC } from '@shared/constants.js';
import type { GitHubGitProgress, GitHubGitProgressKind } from '@shared/types/github.js';
import type { GitProgressContext } from './gitRunner.js';
import { safeWebContentsSend } from '../window/safeWebContentsSend.js';

export function emitGitHubGitProgress(payload: GitHubGitProgress): void {
  safeWebContentsSend(IPC.GITHUB_GIT_PROGRESS, payload);
}

export function gitProgressContext(input: {
  workspaceId?: string;
  owner: string;
  repo: string;
  branch?: string;
}): GitProgressContext {
  const base = {
    workspaceId: input.workspaceId,
    owner: input.owner,
    repo: input.repo,
    branch: input.branch
  };
  return {
    ...base,
    onPhase: (kind: GitHubGitProgressKind, line?: string) => {
      emitGitHubGitProgress({ ...base, kind, line });
    }
  };
}

export function emitGitHubGitDone(input: {
  workspaceId?: string;
  owner: string;
  repo: string;
  branch?: string;
  kind: GitHubGitProgressKind;
}): void {
  emitGitHubGitProgress({ ...input, done: true });
}
