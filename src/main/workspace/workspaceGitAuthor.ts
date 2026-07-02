/**
 * Git author identity — read config and set repo-local fallbacks before commit.
 */

import { userInfo } from 'node:os';
import type { WorkspaceGitRun } from './workspaceGitRunner.js';

export interface GitAuthorHints {
  name?: string | null;
  email?: string | null;
  login?: string | null;
}

export async function gitHasCommits(gitRun: WorkspaceGitRun): Promise<boolean> {
  try {
    await gitRun(['rev-parse', '--verify', 'HEAD']);
    return true;
  } catch {
    return false;
  }
}

async function readGitConfig(
  gitRun: WorkspaceGitRun,
  key: string,
  scope?: 'local' | 'global'
): Promise<string | null> {
  try {
    const args = ['config'];
    if (scope === 'global') args.push('--global');
    args.push('--get', key);
    const value = await gitRun(args);
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

function defaultLocalEmail(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '.')
    .replace(/[^a-z0-9._+-]/g, '');
  return `${slug || 'vyotiq'}@local`;
}

/** Set repo-local user.name / user.email when neither local nor global config exists. */
export async function ensureGitAuthorIdentity(
  gitRun: WorkspaceGitRun,
  hints?: GitAuthorHints
): Promise<void> {
  let name =
    (await readGitConfig(gitRun, 'user.name')) ??
    (await readGitConfig(gitRun, 'user.name', 'global'));
  let email =
    (await readGitConfig(gitRun, 'user.email')) ??
    (await readGitConfig(gitRun, 'user.email', 'global'));

  if (name && email) return;

  const login = hints?.login?.trim();
  const fallbackName =
    hints?.name?.trim() || login || userInfo().username?.trim() || 'Vyotiq User';
  const fallbackEmail =
    hints?.email?.trim() ||
    (login ? `${login}@users.noreply.github.com` : null) ||
    defaultLocalEmail(fallbackName);

  if (!name) await gitRun(['config', 'user.name', fallbackName]);
  if (!email) await gitRun(['config', 'user.email', fallbackEmail]);
}
