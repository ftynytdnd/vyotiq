/**
 * Git base diff helper — `git diff <ref> -- <path>` inside workspace.
 * Respects sandbox containment; read-only.
 */

import { access } from 'node:fs/promises';
import { join } from 'node:path';
import type { GitBaseDiffResult } from '@shared/types/checkpoint.js';
import { realpathInsideWorkspace, SandboxError } from '../tools/sandbox.js';
import { logger } from '../logging/logger.js';
import { runGit } from './runGit.js';

const log = logger.child('checkpoints/gitBaseDiff');

const MAX_PATCH_BYTES = 512 * 1024;

/** Reject ref strings that could escape `git diff` argument boundaries. */
export function validateGitRef(ref: string): string | null {
  const trimmed = ref.trim();
  if (!trimmed || trimmed.length > 200) return null;
  if (!/^[\w./@^~:{}[\]-]+$/.test(trimmed)) return null;
  if (trimmed.includes('..') || trimmed.startsWith('-')) return null;
  return trimmed;
}

export async function gitBaseDiffForFile(input: {
  workspacePath: string;
  filePath: string;
  ref?: string;
}): Promise<GitBaseDiffResult> {
  const rawRef = input.ref?.trim() || 'HEAD';
  const ref = validateGitRef(rawRef);
  if (!ref) {
    return { ok: false, reason: 'git-error', message: 'Invalid git ref' };
  }
  try {
    await realpathInsideWorkspace(input.workspacePath, input.filePath);
  } catch (err) {
    const msg = err instanceof SandboxError ? err.message : String(err);
    return { ok: false, reason: 'path-escaped', message: msg };
  }

  const gitDir = join(input.workspacePath, '.git');
  try {
    await access(gitDir);
  } catch {
    return { ok: false, reason: 'not-a-repo' };
  }

  const rel = input.filePath.replace(/\\/g, '/');

  const res = await runGit(input.workspacePath, ['diff', ref, '--', rel], {
    maxStdoutBytes: MAX_PATCH_BYTES
  });

  if (res.timedOut) {
    return { ok: false, reason: 'git-error', message: res.stderr.trim() || 'git diff timed out' };
  }

  if (res.stderr.trim()) {
    log.debug('git diff stderr', { rel, text: res.stderr.slice(0, 200) });
  }

  if (res.code !== 0 && res.code !== 1) {
    return {
      ok: false,
      reason: 'git-error',
      message: res.stderr.trim() || `git exited ${res.code}`
    };
  }

  const patch = res.stdout;
  if (!patch.trim()) {
    return { ok: false, reason: 'empty' };
  }
  return { ok: true, patch, ref };
}
