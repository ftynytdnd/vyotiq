/**
 * Suppress workspace tree watcher notifications for known self-writes
 * (e.g. in-app editor autosave) so the renderer does not refetch the
 * full tree on every keystroke debounce.
 */

const suppressUntil = new Map<string, number>();

function normRel(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '');
}

function key(workspaceId: string, relPath: string): string {
  return `${workspaceId}:${normRel(relPath)}`;
}

/** Ignore fs.watch events for this relative path until the TTL elapses. */
export function suppressTreeWatchForWrite(
  workspaceId: string,
  relPath: string,
  ttlMs = 2500
): void {
  suppressUntil.set(key(workspaceId, relPath), Date.now() + ttlMs);
}

export function isTreeWatchSuppressed(
  workspaceId: string,
  relPath: string,
  now = Date.now()
): boolean {
  const until = suppressUntil.get(key(workspaceId, relPath));
  if (until === undefined) return false;
  if (now >= until) {
    suppressUntil.delete(key(workspaceId, relPath));
    return false;
  }
  return true;
}

/** Test-only reset. */
export function __test_resetWorkspaceWatchSuppress(): void {
  suppressUntil.clear();
}
