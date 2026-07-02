/**
 * Subscribe to main-process git clone/fetch progress — toast + branch chip.
 */

import { useEffect } from 'react';
import type { GitHubGitProgress } from '@shared/types/github.js';
import { formatGitProgressMessage } from '@shared/github/formatGitProgressMessage.js';
import { gitHubRepoSyncKey } from '@shared/github/repoSyncKey.js';
import { vyotiq } from '../lib/ipc.js';
import { useToastStore } from '../store/useToastStore.js';
import { useGitHubSyncStore } from '../store/useGitHubSyncStore.js';

const GIT_TOAST_KEY = 'github-git';

function syncShortLabel(kind: GitHubGitProgress['kind']): string {
  switch (kind) {
    case 'clone':
      return 'Cloning…';
    case 'fetch':
    case 'pull':
      return 'Fetching…';
    case 'checkout':
      return 'Checking out…';
    default: {
      const _exhaustive: never = kind;
      void _exhaustive;
      return 'Syncing…';
    }
  }
}

function handleProgress(payload: GitHubGitProgress): void {
  const { setWorkspaceSync, setRepoSync } = useGitHubSyncStore.getState();
  const repoKey = gitHubRepoSyncKey(payload.owner, payload.repo);

  if (payload.done) {
    if (payload.workspaceId) setWorkspaceSync(payload.workspaceId, null);
    setRepoSync(repoKey, null);
    useToastStore.getState().dismissKeyed(GIT_TOAST_KEY);
    return;
  }

  const message = formatGitProgressMessage(payload);
  const short = syncShortLabel(payload.kind);
  if (payload.workspaceId) {
    setWorkspaceSync(payload.workspaceId, short);
  } else {
    setRepoSync(repoKey, message);
  }
  useToastStore.getState().showKeyed(GIT_TOAST_KEY, message, 'info');
}

export function useGitHubGitProgress(): void {
  useEffect(() => vyotiq.github.onGitProgress(handleProgress), []);
}
