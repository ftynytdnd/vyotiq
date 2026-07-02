/**

 * Watches the active workspace root for filesystem changes and pushes

 * `workspace:tree-changed` to the renderer. One watcher per active

 * workspace; disposed on switch, remove, and app shutdown.

 */



import { watch, type FSWatcher } from 'node:fs';

import { relative } from 'node:path';

import { IPC } from '@shared/constants.js';

import { WORKSPACE_DOTDIR } from '@shared/constants.js';

import { safeWebContentsSend } from '../window/safeWebContentsSend.js';

import { logger } from '../logging/logger.js';

import { invalidateSkillRegistry } from '../skills/skillRegistry.js';

import { isSkillRelatedPath } from '../skills/skillDiscovery.js';

import { isTreeWatchSuppressed } from './workspaceWatchSuppress.js';



const log = logger.child('workspace/treeWatcher');



const DEBOUNCE_MS = 150;



/** Path segments ignored for tree invalidation (align with fast-glob ignores). */

const IGNORE_SEGMENTS = new Set([

  'node_modules',

  '.git',

  'dist',

  'out',

  '.next',

  WORKSPACE_DOTDIR

]);



interface ActiveWatch {

  workspaceId: string;

  rootPath: string;

  watcher: FSWatcher;

  disposed: boolean;

  debounceTimer: ReturnType<typeof setTimeout> | null;

}



let active: ActiveWatch | null = null;



/** Git metadata paths that should refresh status when changed externally. */

const GIT_STATE_REL_PATHS = new Set([

  '.git/HEAD',

  '.git/index',

  '.git/HEAD.lock',

  '.git/index.lock',

  '.git/refs/heads',

  '.git/refs/remotes'

]);



function isGitStatePath(norm: string): boolean {

  if (GIT_STATE_REL_PATHS.has(norm)) return true;

  return norm.startsWith('.git/refs/heads/') || norm.startsWith('.git/refs/remotes/');

}



function shouldIgnoreRelativePath(rel: string): boolean {

  const norm = rel.replace(/\\/g, '/');

  if (isGitStatePath(norm)) return false;

  if (isSkillRelatedPath(norm)) return false;

  const parts = norm.split('/').filter(Boolean);

  return parts.some((p) => IGNORE_SEGMENTS.has(p));

}



function scheduleEmit(entry: ActiveWatch): void {

  if (entry.disposed) return;

  if (entry.debounceTimer !== null) clearTimeout(entry.debounceTimer);

  entry.debounceTimer = setTimeout(() => {

    entry.debounceTimer = null;

    if (entry.disposed) return;

    safeWebContentsSend(IPC.WORKSPACE_TREE_CHANGED, { workspaceId: entry.workspaceId });

  }, DEBOUNCE_MS);

}



function resolveWatchRelativePath(rootPath: string, filename: string): string {

  const normalized = filename.replace(/\\/g, '/');

  try {

    const rel = relative(rootPath, filename).replace(/\\/g, '/');

    if (!rel.startsWith('..')) return rel;

  } catch {

    /* relative() can throw on cross-drive paths on Windows */

  }

  return normalized.replace(/^\/+/, '');

}



function onWatchEvent(entry: ActiveWatch, _eventType: string, filename: string | Buffer | null): void {

  if (entry.disposed) return;

  if (!filename) {

    scheduleEmit(entry);

    return;

  }

  const name = typeof filename === 'string' ? filename : filename.toString('utf8');

  const rel = resolveWatchRelativePath(entry.rootPath, name);

  if (shouldIgnoreRelativePath(rel)) return;

  if (isSkillRelatedPath(rel)) {

    invalidateSkillRegistry();

  }

  if (isTreeWatchSuppressed(entry.workspaceId, rel)) return;

  scheduleEmit(entry);

}



function disposeEntry(entry: ActiveWatch): void {

  entry.disposed = true;

  if (entry.debounceTimer !== null) {

    clearTimeout(entry.debounceTimer);

    entry.debounceTimer = null;

  }

  try {

    entry.watcher.close();

  } catch (err) {

    log.debug('watcher close failed', { err });

  }

}



/**

 * Stop watching the current workspace. Idempotent.

 */

export function disposeWorkspaceTreeWatcher(): void {

  if (!active) return;

  disposeEntry(active);

  active = null;

}



/**

 * Watch `rootPath` for the given workspace id. Replaces any prior watch.

 */

export function watchActiveWorkspace(workspaceId: string, rootPath: string): void {

  disposeWorkspaceTreeWatcher();

  if (!workspaceId || !rootPath) return;



  let watcher: FSWatcher;

  try {

    watcher = watch(rootPath, { recursive: true }, (eventType, filename) => {

      if (active && !active.disposed) {

        onWatchEvent(active, eventType, filename);

      }

    });

  } catch (err) {

    log.warn('failed to start workspace tree watcher', { workspaceId, rootPath, err });

    return;

  }



  const entry: ActiveWatch = {

    workspaceId,

    rootPath,

    watcher,

    disposed: false,

    debounceTimer: null

  };



  watcher.on('error', (err) => {

    log.debug('workspace tree watcher error', { workspaceId, err });

  });



  active = entry;

  log.info('workspace tree watcher started', { workspaceId, rootPath });

  scheduleEmit(entry);

}



/**

 * Push a tree-changed event immediately (e.g. after CRUD IPC).

 */

export function emitWorkspaceTreeChanged(workspaceId: string): void {

  safeWebContentsSend(IPC.WORKSPACE_TREE_CHANGED, { workspaceId });

}

