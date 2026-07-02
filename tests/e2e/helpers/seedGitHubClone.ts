/**
 * Seed GitHub clone directories on disk for E2E (partial or ready).
 * Uses the isolated Playwright `userDataDir` fixture (same path as Electron).
 */

import { execSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export function resolveE2EClonePath(
  userDataDir: string,
  accountLogin: string,
  owner: string,
  repo: string
): string {
  return join(userDataDir, 'vyotiq', 'repos', accountLogin, 'github.com', owner, repo);
}

/** Incomplete `.git` directory — triggers partial clone recovery UI. */
export async function seedPartialGitHubClone(
  userDataDir: string,
  accountLogin: string,
  owner: string,
  repo: string
): Promise<void> {
  const clonePath = resolveE2EClonePath(userDataDir, accountLogin, owner, repo);
  await mkdir(join(clonePath, '.git'), { recursive: true });
}

/** `git init` at the canonical clone path so `openRepo` succeeds without network. */
export async function seedReadyGitHubClone(
  userDataDir: string,
  accountLogin: string,
  owner: string,
  repo: string
): Promise<void> {
  const clonePath = resolveE2EClonePath(userDataDir, accountLogin, owner, repo);
  await mkdir(clonePath, { recursive: true });
  execSync('git init', { cwd: clonePath, stdio: 'ignore' });
}
