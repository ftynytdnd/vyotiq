/**
 * Git status for workspace file tree decorations — spawns `git` directly.
 */

import { spawn } from 'node:child_process';

export type GitPathStatus = 'M' | 'A' | 'D' | 'U' | 'R' | '?';

const GIT_TIMEOUT_MS = 2000;

function mapPorcelainStatus(index: string, worktree: string): GitPathStatus | null {
  if (index === '?' && worktree === '?') return '?';
  if (index === 'A' || worktree === 'A') return 'A';
  if (index === 'D' || worktree === 'D') return 'D';
  if (index === 'U' || worktree === 'U') return 'U';
  if (index === 'R' || worktree === 'R') return 'R';
  if (index === 'M' || worktree === 'M') return 'M';
  if (index === ' ' && worktree === 'M') return 'M';
  if (index === 'M' && worktree === ' ') return 'M';
  if (index !== ' ' || worktree !== ' ') return 'M';
  return null;
}

export function parseGitPorcelain(stdout: string): Record<string, GitPathStatus> {
  const map: Record<string, GitPathStatus> = {};
  for (const line of stdout.split(/\r?\n/)) {
    if (line.length < 4) continue;
    const index = line[0] ?? ' ';
    const worktree = line[1] ?? ' ';
    let rawPath = line.slice(3).trim();
    if (rawPath.includes(' -> ')) {
      rawPath = rawPath.split(' -> ').pop()!.trim();
    }
    const norm = rawPath.replace(/\\/g, '/');
    const status = mapPorcelainStatus(index, worktree);
    if (status) map[norm] = status;
  }
  return map;
}

export function getWorkspaceGitStatus(wsPath: string): Promise<Record<string, GitPathStatus>> {
  return new Promise((resolve) => {
    const child = spawn('git', ['-C', wsPath, 'status', '--porcelain', '-u'], {
      windowsHide: true
    });
    let stdout = '';
    const timer = setTimeout(() => {
      child.kill();
      resolve({});
    }, GIT_TIMEOUT_MS);
    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve({});
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        resolve({});
        return;
      }
      resolve(parseGitPorcelain(stdout));
    });
  });
}
