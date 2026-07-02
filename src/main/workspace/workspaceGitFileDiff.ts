/**
 * Per-file git diffs for the source-control changes popover.
 */

import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import type { GitPathStatus } from '@shared/types/ipc.js';
import type { DiffHunk } from '@shared/types/tool.js';
import { computeDiffHunks } from '@shared/text/diff/computeDiffHunks.js';
import { decodeDiskTextBuffer, probeBinaryText } from '../text/decodeDiskText.js';
import { resolveInsideWorkspace } from '../tools/sandbox.js';

const GIT_TIMEOUT_MS = 15_000;
const MAX_DIFF_BYTES = 512 * 1024;

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
      resolve(code === 0 ? stdout : null);
    });
  });
}

export async function readWorkspaceTextFileCapped(
  wsPath: string,
  relativePath: string
): Promise<{ text: string; truncated: boolean; binary: boolean } | null> {
  try {
    const abs = resolveInsideWorkspace(wsPath, relativePath);
    const lst = await fs.lstat(abs);
    if (lst.isSymbolicLink()) {
      return { text: '', truncated: false, binary: true };
    }
    if (!lst.isFile()) {
      return null;
    }
    const readLen = Math.min(lst.size, MAX_DIFF_BYTES);
    const fh = await fs.open(abs, 'r');
    try {
      const buf = Buffer.alloc(readLen);
      await fh.read(buf, 0, readLen, 0);
      if (!probeBinaryText(buf).ok) {
        return { text: '', truncated: false, binary: true };
      }
      const { body } = decodeDiskTextBuffer(buf);
      return { text: body, truncated: lst.size > MAX_DIFF_BYTES, binary: false };
    } finally {
      await fh.close();
    }
  } catch {
    return null;
  }
}

async function gitHeadFile(wsPath: string, relativePath: string): Promise<string> {
  const out = await runGit(wsPath, ['show', `HEAD:${relativePath}`]);
  return out ?? '';
}

async function gitIndexFile(wsPath: string, relativePath: string): Promise<string | null> {
  return runGit(wsPath, ['show', `:${relativePath}`]);
}

function buildHunkResult(
  path: string,
  status: GitPathStatus,
  before: string,
  after: string,
  opts?: { binary?: boolean; truncated?: boolean }
): { path: string; status: GitPathStatus; hunks: DiffHunk[]; binary?: boolean; truncated?: boolean } {
  if (opts?.binary) {
    return { path, status, hunks: [], binary: true };
  }
  return {
    path,
    status,
    hunks: computeDiffHunks(before, after),
    ...(opts?.truncated ? { truncated: true } : {})
  };
}

export interface WorkspaceGitFileDiffPayload {
  path: string;
  status: GitPathStatus;
  hunks: DiffHunk[];
  binary?: boolean;
  truncated?: boolean;
}

export async function getWorkspaceGitFileDiff(
  wsPath: string,
  relativePath: string,
  status: GitPathStatus,
  opts?: { staged?: boolean }
): Promise<WorkspaceGitFileDiffPayload> {
  const path = relativePath.replace(/\\/g, '/');
  const staged = opts?.staged ?? false;

  if (status === '?' || (status === 'A' && !staged)) {
    const read = await readWorkspaceTextFileCapped(wsPath, path);
    if (!read) {
      return { path, status, hunks: [], binary: true };
    }
    if (read.binary) {
      return { path, status, hunks: [], binary: true };
    }
    return buildHunkResult(path, status, '', read.text, { truncated: read.truncated });
  }

  if (status === 'A' && staged) {
    const read = await readWorkspaceTextFileCapped(wsPath, path);
    if (!read) {
      return { path, status, hunks: [], binary: true };
    }
    if (read.binary) {
      return { path, status, hunks: [], binary: true };
    }
    return buildHunkResult(path, status, '', read.text, { truncated: read.truncated });
  }

  if (status === 'D') {
    const before = staged
      ? await gitHeadFile(wsPath, path)
      : ((await gitIndexFile(wsPath, path)) ?? (await gitHeadFile(wsPath, path)));
    return buildHunkResult(path, status, before, '');
  }

  const head = await gitHeadFile(wsPath, path);
  const index = (await gitIndexFile(wsPath, path)) ?? head;

  if (staged) {
    const worktree = await readWorkspaceTextFileCapped(wsPath, path);
    if (!worktree) {
      return { path, status, hunks: [], binary: true };
    }
    if (worktree.binary) {
      return { path, status, hunks: [], binary: true };
    }
    return buildHunkResult(path, status, head, index);
  }

  const worktree = await readWorkspaceTextFileCapped(wsPath, path);
  if (!worktree) {
    return buildHunkResult(path, status, index, '');
  }
  if (worktree.binary) {
    return { path, status, hunks: [], binary: true };
  }
  return buildHunkResult(path, status, index, worktree.text, { truncated: worktree.truncated });
}
