/** Stable key for in-flight git sync before a workspace row exists. */
export function gitHubRepoSyncKey(owner: string, repo: string): string {
  return `${owner}/${repo}`;
}
