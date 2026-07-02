/**
 * Git subprocess helpers with HTTPS token auth (main process only).
 */

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { githubCloneUrl, normalizeGitHubHost } from '@shared/github/githubHosts.js';
import type { GitHubCloneState, GitHubGitProgressKind } from '@shared/types/github.js';
import { logger } from '../logging/logger.js';
import { gitResolveSyncRemote } from '../workspace/workspaceGitOps.js';
import type { WorkspaceGitRun } from '../workspace/workspaceGitRunner.js';

const log = logger.child('github/git');
const GIT_TIMEOUT_MS = 120_000;

export type GitStderrHandler = (line: string) => void;

export interface GitProgressContext {
  workspaceId?: string;
  owner: string;
  repo: string;
  branch?: string;
  onPhase?: (kind: GitHubGitProgressKind, line?: string) => void;
}

function credentialHelperArg(host: string, token: string): string {
  const safeHost = host.replace(/"/g, '');
  const safeToken = token.replace(/"/g, '');
  if (process.platform === 'win32') {
    return `!f() { echo protocol=https; echo host=${safeHost}; echo username=x-access-token; echo password=${safeToken}; }; f`;
  }
  return `!f() { printf '%s\\n' 'username=x-access-token' "password=${safeToken}"; }; f`;
}

export function runGitPlain(
  args: string[],
  opts?: { timeoutMs?: number; onStderr?: GitStderrHandler }
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('git command timed out'));
    }, opts?.timeoutMs ?? GIT_TIMEOUT_MS);
    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      stderr += text;
      if (opts?.onStderr) {
        for (const line of text.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (trimmed.length > 0) opts.onStderr(trimmed);
        }
      }
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || stdout.trim() || `git exited ${code}`));
    });
  });
}

export async function runGitWithToken(
  token: string,
  host: string,
  args: string[],
  opts?: { timeoutMs?: number; onStderr?: GitStderrHandler }
): Promise<string> {
  const h = normalizeGitHubHost(host);
  const helper = credentialHelperArg(h, token);
  const gitArgs = ['-c', `credential.helper=${helper}`, ...args];
  return runGitPlain(gitArgs, opts);
}

export async function gitRemoteOriginUrl(wsPath: string): Promise<string | null> {
  try {
    const out = await runGitPlain(['-C', wsPath, 'remote', 'get-url', 'origin'], {
      timeoutMs: 5_000
    });
    return out || null;
  } catch {
    return null;
  }
}

/** Normalize clone URLs for comparison (https vs ssh). */
export function normalizeRemoteUrl(url: string): string {
  const trimmed = url.trim().replace(/\.git$/, '');
  const ssh = trimmed.match(/^git@([^:]+):(.+)$/);
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`.toLowerCase();
  try {
    const u = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    return `${u.protocol}//${u.host}${u.pathname}`.toLowerCase().replace(/\/$/, '');
  } catch {
    return trimmed.toLowerCase();
  }
}

export function expectedRemoteUrl(host: string, owner: string, repo: string): string {
  return normalizeRemoteUrl(githubCloneUrl(host, owner, repo));
}

export async function cloneRepo(opts: {
  host: string;
  owner: string;
  repo: string;
  branch: string;
  destPath: string;
  token: string;
  progress?: GitProgressContext;
}): Promise<void> {
  const parent = join(opts.destPath, '..');
  await fs.mkdir(parent, { recursive: true });
  const url = githubCloneUrl(opts.host, opts.owner, opts.repo);
  const args = [
    'clone',
    '--origin',
    'origin',
    '--branch',
    opts.branch,
    '--single-branch',
    '--progress',
    url,
    opts.destPath
  ];
  log.info('cloning repo', {
    owner: opts.owner,
    repo: opts.repo,
    branch: opts.branch,
    dest: opts.destPath
  });
  const onStderr = opts.progress
    ? (line: string) => opts.progress?.onPhase?.('clone', line)
    : undefined;
  opts.progress?.onPhase?.('clone');
  await runGitWithToken(opts.token, opts.host, args, { onStderr });
}

export async function fetchAndCheckout(
  wsPath: string,
  branch: string,
  token: string,
  host: string,
  progress?: GitProgressContext
): Promise<void> {
  const onFetchStderr = progress
    ? (line: string) => progress.onPhase?.('fetch', line)
    : undefined;
  const gitRun: WorkspaceGitRun = (args) =>
    runGitWithToken(token, host, ['-C', wsPath, ...args], {
      onStderr: onFetchStderr
    });
  const remote = await gitResolveSyncRemote(gitRun, branch);
  if (!remote) {
    throw new Error(
      'No git remote configured. Add one with `git remote add <name> <url>` to fetch or switch branches.'
    );
  }
  progress?.onPhase?.('fetch');
  await runGitWithToken(token, host, ['-C', wsPath, 'fetch', remote, branch, '--prune'], {
    onStderr: onFetchStderr
  });
  progress?.onPhase?.('checkout');
  await runGitWithToken(token, host, ['-C', wsPath, 'checkout', branch]);
  progress?.onPhase?.('pull');
  await runGitWithToken(token, host, ['-C', wsPath, 'pull', '--ff-only', remote, branch]);
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

/** Detect whether a clone destination is missing, usable, or interrupted. */
export async function detectGitCloneState(path: string): Promise<GitHubCloneState> {
  if (!(await pathExists(path))) return 'absent';
  const gitDir = join(path, '.git');
  if (!(await pathExists(gitDir))) return 'absent';
  try {
    const inside = await runGitPlain(['-C', path, 'rev-parse', '--is-inside-work-tree'], {
      timeoutMs: 5_000
    });
    if (inside === 'true') {
      await runGitPlain(['-C', path, 'rev-parse', 'HEAD'], { timeoutMs: 5_000 });
      return 'ready';
    }
  } catch {
    // incomplete checkout or corrupt repo
  }
  return 'partial';
}

/** Remove a failed/incomplete clone directory so git clone can retry. */
export async function removePartialClone(path: string): Promise<void> {
  log.warn('removing partial git clone', { path });
  await fs.rm(path, { recursive: true, force: true });
}
