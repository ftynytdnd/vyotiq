import type { WorkspaceGitHubBinding } from '../types/github.js';

/** Dock / status subtitle for a GitHub-bound workspace. */
export function workspaceGitHubSubtitle(binding: WorkspaceGitHubBinding): string {
  return `${binding.owner}/${binding.repo} @ ${binding.branch}`;
}
