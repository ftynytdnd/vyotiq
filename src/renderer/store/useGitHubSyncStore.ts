/**
 * Per-workspace GitHub git sync labels (branch chip + progress).
 */

import { create } from 'zustand';

interface GitHubSyncStore {
  /** workspaceId → status message (e.g. "Fetching…"). */
  workspaceSync: Record<string, string>;
  /** owner/repo → status while clone runs before a workspace exists. */
  repoSync: Record<string, string>;
  setWorkspaceSync: (workspaceId: string, message: string | null) => void;
  setRepoSync: (repoKey: string, message: string | null) => void;
}

export const useGitHubSyncStore = create<GitHubSyncStore>((set) => ({
  workspaceSync: {},
  repoSync: {},
  setWorkspaceSync: (workspaceId, message) =>
    set((s) => {
      const next = { ...s.workspaceSync };
      if (!message) delete next[workspaceId];
      else next[workspaceId] = message;
      return { workspaceSync: next };
    }),
  setRepoSync: (repoKey, message) =>
    set((s) => {
      const next = { ...s.repoSync };
      if (!message) delete next[repoKey];
      else next[repoKey] = message;
      return { repoSync: next };
    })
}));
