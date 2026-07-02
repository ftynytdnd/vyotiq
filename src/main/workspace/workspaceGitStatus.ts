/**
 * Git status for workspace file tree decorations — spawns `git` directly.
 */

import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import type { WorkspaceGitContext } from '@shared/types/ipc.js';
import {
  parseRemoteList,
  pickDefaultRemote,
  remoteFromUpstreamRef
} from './workspaceGitRemote.js';

export type GitPathStatus = 'M' | 'A' | 'D' | 'U' | 'R' | '?';

export interface GitFileState {
  staged?: GitPathStatus;
  unstaged?: GitPathStatus;
}

const GIT_TIMEOUT_MS = 8000;

/** Unquote Git porcelain C-style quoted paths (`"path with spaces"`). */
export function normalizePorcelainPath(raw: string): string {
  let path = raw.trim();
  if (path.includes(' -> ')) {
    path = path.split(' -> ').pop()!.trim();
  }
  if (path.startsWith('"') && path.endsWith('"') && path.length >= 2) {
    path = unquoteGitCPath(path.slice(1, -1));
  }
  return path.replace(/\\/g, '/');
}

function unquoteGitCPath(quoted: string): string {
  let out = '';
  for (let i = 0; i < quoted.length; i++) {
    const c = quoted[i]!;
    if (c === '\\' && i + 1 < quoted.length) {
      const n = quoted[++i]!;
      switch (n) {
        case 'n':
          out += '\n';
          break;
        case 't':
          out += '\t';
          break;
        case 'b':
          out += '\b';
          break;
        case 'f':
          out += '\f';
          break;
        case '\\':
        case '"':
          out += n;
          break;
        default:
          out += n;
          break;
      }
    } else {
      out += c;
    }
  }
  return out;
}

function inferIsRepo(
  isInsideWorkTree: string | null,
  headShort: string | null,
  dirtyCount: number,
  hasGitDir?: boolean
): boolean {
  if (isInsideWorkTree === 'true') return true;
  if (isInsideWorkTree === 'false') return false;
  if (hasGitDir) return true;
  return dirtyCount > 0 || Boolean(headShort);
}

async function workspaceHasGitDir(wsPath: string): Promise<boolean> {
  try {
    await access(join(wsPath, '.git'));
    return true;
  } catch {
    return false;
  }
}

function mapIndexStatus(code: string): GitPathStatus | null {
  if (code === ' ') return null;
  if (code === '?') return '?';
  if (code === 'A') return 'A';
  if (code === 'D') return 'D';
  if (code === 'U') return 'U';
  if (code === 'R') return 'R';
  if (code === 'M') return 'M';
  return 'M';
}

function mapWorktreeStatus(code: string): GitPathStatus | null {
  if (code === ' ') return null;
  if (code === '?') return '?';
  if (code === 'A') return 'A';
  if (code === 'D') return 'D';
  if (code === 'U') return 'U';
  if (code === 'R') return 'R';
  if (code === 'M') return 'M';
  return 'M';
}

/** Badge / dock decoration — prefer unstaged over staged. */
export function combineGitFileState(entry: GitFileState): GitPathStatus | null {
  if (entry.unstaged) return entry.unstaged;
  if (entry.staged) return entry.staged;
  return null;
}

export function parseGitPorcelainDetailed(stdout: string): Record<string, GitFileState> {
  const map: Record<string, GitFileState> = {};
  for (const line of stdout.split(/\r?\n/)) {
    if (line.length < 4) continue;
    const index = line[0] ?? ' ';
    const worktree = line[1] ?? ' ';
    let rawPath = line.slice(3);
    const norm = normalizePorcelainPath(rawPath);
    // Untracked (`??`) belongs in the changes column only — never staged.
    const staged =
      index === '?' && worktree === '?' ? null : mapIndexStatus(index);
    const unstaged = mapWorktreeStatus(worktree);
    if (!staged && !unstaged) continue;
    map[norm] = {
      ...(staged ? { staged } : {}),
      ...(unstaged ? { unstaged } : {})
    };
  }
  return map;
}

export function gitFileStatesToPaths(entries: Record<string, GitFileState>): Record<string, GitPathStatus> {
  const paths: Record<string, GitPathStatus> = {};
  for (const [path, entry] of Object.entries(entries)) {
    const combined = combineGitFileState(entry);
    if (combined) paths[path] = combined;
  }
  return paths;
}

export function splitGitFileStates(entries: Record<string, GitFileState>): {
  staged: Record<string, GitPathStatus>;
  unstaged: Record<string, GitPathStatus>;
} {
  const staged: Record<string, GitPathStatus> = {};
  const unstaged: Record<string, GitPathStatus> = {};
  for (const [path, entry] of Object.entries(entries)) {
    if (entry.staged && entry.staged !== '?') staged[path] = entry.staged;
    if (entry.unstaged) unstaged[path] = entry.unstaged;
  }
  return { staged, unstaged };
}

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
    let rawPath = line.slice(3);
    const norm = normalizePorcelainPath(rawPath);
    const status = mapPorcelainStatus(index, worktree);
    if (status) map[norm] = status;
  }
  return map;
}

function runGit(wsPath: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn('git', ['-C', wsPath, ...args], { windowsHide: true });
    let stdout = '';
    const timer = setTimeout(() => {
      child.kill();
      resolve(null);
    }, GIT_TIMEOUT_MS);
    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    });
    child.stderr?.on('data', () => {});
    child.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? stdout.trim() : null);
    });
  });
}

export function buildGitContextFromGitOutput(opts: {
  isInsideWorkTree: string | null;
  abbrevRef: string | null;
  headShort: string | null;
  dirtyCount: number;
  ahead?: number;
  behind?: number;
  remote?: string | null;
  hasGitDir?: boolean;
}): WorkspaceGitContext {
  const isRepo = inferIsRepo(opts.isInsideWorkTree, opts.headShort, opts.dirtyCount, opts.hasGitDir);
  if (!isRepo) {
    return { isRepo: false, branch: null, headShort: null, dirtyCount: 0, remote: null };
  }
  const branchRaw = opts.abbrevRef ?? '';
  const detached = branchRaw === 'HEAD';
  const ctx: WorkspaceGitContext = {
    isRepo: true,
    branch: detached ? null : branchRaw || null,
    headShort: opts.headShort || null,
    dirtyCount: opts.dirtyCount,
    remote: opts.remote ?? null
  };
  if (opts.ahead != null && opts.ahead > 0) ctx.ahead = opts.ahead;
  if (opts.behind != null && opts.behind > 0) ctx.behind = opts.behind;
  return ctx;
}

async function resolveSyncRemote(wsPath: string, branch: string | null): Promise<string | null> {
  if (branch) {
    const upstream = await runGit(wsPath, [
      'rev-parse',
      '--abbrev-ref',
      '--symbolic-full-name',
      `${branch}@{upstream}`
    ]);
    if (upstream) {
      const tracked = remoteFromUpstreamRef(upstream);
      if (tracked) return tracked;
    }
  }
  const remotesOut = await runGit(wsPath, ['remote']);
  return pickDefaultRemote(remotesOut ? parseRemoteList(remotesOut) : []);
}

async function getAheadBehind(
  wsPath: string,
  branch: string | null,
  remote: string | null
): Promise<{ ahead: number; behind: number } | null> {
  if (!branch || !remote) return null;
  const remoteRef = `${remote}/${branch}`;
  const verify = await runGit(wsPath, ['rev-parse', '--verify', remoteRef]);
  if (!verify) return null;
  const count = await runGit(wsPath, [
    'rev-list',
    '--left-right',
    '--count',
    `${remoteRef}...HEAD`
  ]);
  if (!count) return null;
  const parts = count.split(/\s+/);
  const behind = Number.parseInt(parts[0] ?? '0', 10);
  const ahead = Number.parseInt(parts[1] ?? '0', 10);
  if (!Number.isFinite(ahead) || !Number.isFinite(behind)) return null;
  return { ahead, behind };
}

export async function getWorkspaceGitContext(wsPath: string): Promise<WorkspaceGitContext> {
  const [isInsideWorkTree, abbrevRef, headShort, paths, hasGitDir] = await Promise.all([
    runGit(wsPath, ['rev-parse', '--is-inside-work-tree']),
    runGit(wsPath, ['rev-parse', '--abbrev-ref', 'HEAD']),
    runGit(wsPath, ['rev-parse', '--short', 'HEAD']),
    getWorkspaceGitStatus(wsPath),
    workspaceHasGitDir(wsPath)
  ]);
  const branchRaw = abbrevRef ?? '';
  const branch = branchRaw === 'HEAD' ? null : branchRaw || null;
  const remote = isInsideWorkTree === 'true' ? await resolveSyncRemote(wsPath, branch) : null;
  const sync = await getAheadBehind(wsPath, branch, remote);
  return buildGitContextFromGitOutput({
    isInsideWorkTree,
    abbrevRef,
    headShort,
    dirtyCount: Object.keys(paths).length,
    ahead: sync?.ahead,
    behind: sync?.behind,
    remote,
    hasGitDir
  });
}

export interface WorkspaceGitStatusPayload {
  paths: Record<string, GitPathStatus>;
  staged: Record<string, GitPathStatus>;
  unstaged: Record<string, GitPathStatus>;
  entries: Record<string, GitFileState>;
  context: WorkspaceGitContext;
}

function buildStatusPayload(
  stdout: string,
  meta: {
    isInsideWorkTree: string | null;
    abbrevRef: string | null;
    headShort: string | null;
    ahead?: number;
    behind?: number;
    remote?: string | null;
    hasGitDir?: boolean;
  }
): WorkspaceGitStatusPayload {
  const entries = parseGitPorcelainDetailed(stdout);
  const paths = gitFileStatesToPaths(entries);
  const { staged, unstaged } = splitGitFileStates(entries);
  const context = buildGitContextFromGitOutput({
    isInsideWorkTree: meta.isInsideWorkTree,
    abbrevRef: meta.abbrevRef,
    headShort: meta.headShort,
    dirtyCount: Object.keys(paths).length,
    ahead: meta.ahead,
    behind: meta.behind,
    remote: meta.remote,
    hasGitDir: meta.hasGitDir
  });
  return { paths, staged, unstaged, entries, context };
}

export async function getWorkspaceGitStatusPayload(wsPath: string): Promise<WorkspaceGitStatusPayload> {
  const [porcelain, isInsideWorkTree, abbrevRef, headShort, hasGitDir] = await Promise.all([
    readGitPorcelain(wsPath),
    runGit(wsPath, ['rev-parse', '--is-inside-work-tree']),
    runGit(wsPath, ['rev-parse', '--abbrev-ref', 'HEAD']),
    runGit(wsPath, ['rev-parse', '--short', 'HEAD']),
    workspaceHasGitDir(wsPath)
  ]);
  const branchRaw = abbrevRef ?? '';
  const branch = branchRaw === 'HEAD' ? null : branchRaw || null;
  const remote = isInsideWorkTree === 'true' ? await resolveSyncRemote(wsPath, branch) : null;
  const sync = await getAheadBehind(wsPath, branch, remote);
  return buildStatusPayload(porcelain, {
    isInsideWorkTree,
    abbrevRef,
    headShort,
    ahead: sync?.ahead,
    behind: sync?.behind,
    remote,
    hasGitDir
  });
}

function readGitPorcelain(wsPath: string): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn('git', ['-C', wsPath, 'status', '--porcelain', '-u'], {
      windowsHide: true
    });
    let stdout = '';
    const timer = setTimeout(() => {
      child.kill();
      resolve('');
    }, GIT_TIMEOUT_MS);
    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    });
    child.stderr?.on('data', () => {});
    child.on('error', () => {
      clearTimeout(timer);
      resolve('');
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? stdout : '');
    });
  });
}

export function getWorkspaceGitStatus(wsPath: string): Promise<Record<string, GitPathStatus>> {
  return readGitPorcelain(wsPath).then((stdout) => parseGitPorcelain(stdout));
}
