/**
 * Resolve which git remote to use for fetch/pull/push and ahead/behind.
 */

export function parseRemoteList(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function remoteFromUpstreamRef(upstream: string): string | null {
  const slash = upstream.indexOf('/');
  if (slash <= 0) return null;
  return upstream.slice(0, slash);
}

export function pickDefaultRemote(remotes: string[]): string | null {
  if (remotes.includes('origin')) return 'origin';
  return remotes[0] ?? null;
}
