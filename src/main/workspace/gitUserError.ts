/**
 * User-facing git errors — misconfiguration or remote access, not app bugs.
 */

export class GitUserError extends Error {
  readonly name = 'GitUserError';

  constructor(message: string) {
    super(message);
  }
}

export function isGitUserError(err: unknown): err is GitUserError {
  return err instanceof GitUserError;
}

export function assertGitRemote(remote: string | null): asserts remote is string {
  if (!remote) {
    throw new GitUserError(
      'No git remote configured. Add one with `git remote add <name> <url>` to fetch, pull, or push.'
    );
  }
}

/** Map common git stderr to short UI copy; rethrow unknown errors unchanged. */
export function rethrowGitSyncError(err: unknown): never {
  if (isGitUserError(err)) throw err;
  const msg = err instanceof Error ? err.message : String(err);
  if (/does not appear to be a git repository/i.test(msg)) {
    throw new GitUserError('This folder is not a git repository.');
  }
  if (/Could not read from remote repository/i.test(msg)) {
    throw new GitUserError(
      'Could not reach the remote. Check your network, credentials, and remote URL.'
    );
  }
  if (/no upstream branch/i.test(msg) || /has no upstream branch/i.test(msg)) {
    throw new GitUserError(
      'Branch has no upstream. Push once with upstream set, or configure tracking in git.'
    );
  }
  if (/Author identity unknown/i.test(msg) || /unable to auto-detect email address/i.test(msg)) {
    throw new GitUserError(
      'Git author name and email are not configured. Set them with `git config user.name` and `git config user.email` (add `--global` to apply everywhere).'
    );
  }
  throw err instanceof Error ? err : new Error(msg);
}
