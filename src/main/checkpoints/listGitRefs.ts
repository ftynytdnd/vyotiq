/**
 * List git refs for review "compare to base" UI (local + remote).
 * Read-only; workspace-contained.
 */

import { access } from 'node:fs/promises';
import { join } from 'node:path';
import type { GitRefOption, ListGitRefsResult } from '@shared/types/checkpoint.js';
import { validateGitRef } from './gitBaseDiff.js';
import { runGit } from './runGit.js';
import { logger } from '../logging/logger.js';

const log = logger.child('checkpoints/listGitRefs');

const MAX_LOCAL = 40;
const MAX_REMOTE = 40;

async function refsUnder(
  workspacePath: string,
  refPrefix: string,
  cap: number
): Promise<string[]> {
  const res = await runGit(workspacePath, [
    'for-each-ref',
    '--format=%(refname:short)',
    '--sort=-committerdate',
    refPrefix
  ]);
  if (res.timedOut) return [];
  if (res.code !== 0) return [];

  const names: string[] = [];
  for (const line of res.stdout.split('\n')) {
    if (names.length >= cap) break;
    const name = line.trim();
    if (!name || name.endsWith('/HEAD')) continue;
    names.push(name);
  }
  return names;
}

export async function listGitRefs(workspacePath: string): Promise<ListGitRefsResult> {
  const gitDir = join(workspacePath, '.git');
  try {
    await access(gitDir);
  } catch {
    return { ok: false, reason: 'not-a-repo' };
  }

  const headRes = await runGit(workspacePath, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (headRes.timedOut) {
    return {
      ok: false,
      reason: 'git-error',
      message: headRes.stderr.trim() || 'git rev-parse timed out'
    };
  }
  if (headRes.code !== 0) {
    log.debug('rev-parse HEAD failed', { stderr: headRes.stderr.slice(0, 200) });
    return { ok: false, reason: 'git-error', message: headRes.stderr.trim() || 'git rev-parse failed' };
  }
  const head = headRes.stdout.trim() || 'HEAD';

  const [localNames, remoteNames] = await Promise.all([
    refsUnder(workspacePath, 'refs/heads/', MAX_LOCAL),
    refsUnder(workspacePath, 'refs/remotes/', MAX_REMOTE)
  ]);

  const seen = new Set<string>();
  const options: GitRefOption[] = [];

  const pushRef = (ref: string, group: GitRefOption['group']) => {
    const v = validateGitRef(ref);
    if (!v || seen.has(v)) return;
    seen.add(v);
    options.push({ ref: v, group });
  };

  pushRef('HEAD', 'builtin');
  if (head !== 'HEAD') pushRef(head, 'local');
  for (const name of localNames) pushRef(name, 'local');
  for (const name of remoteNames) pushRef(name, 'remote');

  return { ok: true, options, head };
}
