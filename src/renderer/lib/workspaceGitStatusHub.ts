/**
 * Shared git status polling — one interval per workspace, many subscribers.
 */

import type {
  GitFileState,
  GitPathStatus,
  WorkspaceGitContext,
  WorkspaceGitStatusResult,
  WorkspaceTreeChangedPayload
} from '@shared/types/ipc.js';
import { vyotiq } from './ipc.js';
import { subscribeWorkspaceTreeChanged } from './workspaceTreeChangeHub.js';

const POLL_MS = 5_000;
const TREE_REFRESH_DEBOUNCE_MS = 350;

const EMPTY_CONTEXT: WorkspaceGitContext = {
  isRepo: false,
  branch: null,
  headShort: null,
  dirtyCount: 0,
  remote: null
};

const EMPTY_ENTRIES: Record<string, GitFileState> = {};

export interface WorkspaceGitPollSnapshot {
  paths: Record<string, GitPathStatus>;
  staged: Record<string, GitPathStatus>;
  unstaged: Record<string, GitPathStatus>;
  entries: Record<string, GitFileState>;
  context: WorkspaceGitContext;
}

const EMPTY_SNAPSHOT: WorkspaceGitPollSnapshot = {
  paths: {},
  staged: {},
  unstaged: {},
  entries: EMPTY_ENTRIES,
  context: EMPTY_CONTEXT
};

type GitStatusListener = (snapshot: WorkspaceGitPollSnapshot) => void;

interface WorkspaceGitStatusHub {
  refCount: number;
  timer: ReturnType<typeof setInterval> | null;
  treeUnsub: (() => void) | null;
  treeDebounceTimer: ReturnType<typeof setTimeout> | null;
  listeners: Set<GitStatusListener>;
  snapshot: WorkspaceGitPollSnapshot;
  inflight: boolean;
}

const hubs = new Map<string, WorkspaceGitStatusHub>();
const snapshotCache = new Map<string, WorkspaceGitPollSnapshot>();

function cloneSnapshot(snap: WorkspaceGitPollSnapshot): WorkspaceGitPollSnapshot {
  return {
    paths: { ...snap.paths },
    staged: { ...snap.staged },
    unstaged: { ...snap.unstaged },
    entries: { ...snap.entries },
    context: { ...snap.context }
  };
}

function snapshotsEqual(a: WorkspaceGitPollSnapshot, b: WorkspaceGitPollSnapshot): boolean {
  const ac = a.context;
  const bc = b.context;
  if (
    ac.isRepo !== bc.isRepo ||
    ac.branch !== bc.branch ||
    ac.headShort !== bc.headShort ||
    ac.dirtyCount !== bc.dirtyCount ||
    ac.ahead !== bc.ahead ||
    ac.behind !== bc.behind ||
    ac.remote !== bc.remote
  ) {
    return false;
  }
  const aKeys = Object.keys(a.entries);
  const bKeys = Object.keys(b.entries);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    const ae = a.entries[key];
    const be = b.entries[key];
    if (!be || ae?.staged !== be.staged || ae?.unstaged !== be.unstaged) return false;
  }
  return true;
}

function applyResult(hub: WorkspaceGitStatusHub, result: WorkspaceGitStatusResult): boolean {
  const next: WorkspaceGitPollSnapshot = {
    paths: result.paths,
    staged: result.staged ?? {},
    unstaged: result.unstaged ?? {},
    entries: result.entries ?? EMPTY_ENTRIES,
    context: result.context ?? EMPTY_CONTEXT
  };
  if (snapshotsEqual(hub.snapshot, next)) return false;
  hub.snapshot = next;
  return true;
}

function notifyHub(hub: WorkspaceGitStatusHub): void {
  const snap = hub.snapshot;
  for (const listener of hub.listeners) {
    try {
      listener(snap);
    } catch {
      /* isolate subscriber failures */
    }
  }
}

/** Refresh git status immediately (e.g. after a successful mutation). */
export function refreshWorkspaceGitStatusNow(workspaceId: string): void {
  if (hubs.has(workspaceId)) {
    refreshHub(workspaceId);
    return;
  }
  prefetchWorkspaceGitStatus(workspaceId);
}

function refreshHub(workspaceId: string): void {
  const hub = hubs.get(workspaceId);
  if (!hub || hub.inflight) return;
  hub.inflight = true;
  void vyotiq.workspace
    .gitStatus({ workspaceId })
    .then((result) => {
      const active = hubs.get(workspaceId);
      if (!active || active !== hub) return;
      if (applyResult(hub, result)) {
        snapshotCache.set(workspaceId, cloneSnapshot(hub.snapshot));
        notifyHub(hub);
      }
    })
    .catch(() => {
      /* keep last good snapshot on transient git failures */
    })
    .finally(() => {
      const active = hubs.get(workspaceId);
      if (active === hub) active.inflight = false;
    });
}

function scheduleTreeRefresh(workspaceId: string): void {
  const hub = hubs.get(workspaceId);
  if (!hub) return;
  if (hub.treeDebounceTimer !== null) clearTimeout(hub.treeDebounceTimer);
  hub.treeDebounceTimer = setTimeout(() => {
    hub.treeDebounceTimer = null;
    refreshHub(workspaceId);
  }, TREE_REFRESH_DEBOUNCE_MS);
}

function startHub(workspaceId: string, hub: WorkspaceGitStatusHub): void {
  refreshHub(workspaceId);
  hub.timer = setInterval(() => refreshHub(workspaceId), POLL_MS);
  hub.treeUnsub = subscribeWorkspaceTreeChanged((payload: WorkspaceTreeChangedPayload) => {
    if (payload.workspaceId === workspaceId) scheduleTreeRefresh(workspaceId);
  });
}

function stopHub(workspaceId: string, hub: WorkspaceGitStatusHub): void {
  if (hub.timer !== null) clearInterval(hub.timer);
  if (hub.treeDebounceTimer !== null) clearTimeout(hub.treeDebounceTimer);
  hub.treeUnsub?.();
  snapshotCache.set(workspaceId, cloneSnapshot(hub.snapshot));
  hubs.delete(workspaceId);
}

/** Warm git status after workspace activation (e.g. right after tree watcher starts). */
export function prefetchWorkspaceGitStatus(workspaceId: string): void {
  const hub = hubs.get(workspaceId);
  if (hub) {
    refreshHub(workspaceId);
    return;
  }
  void vyotiq.workspace.gitStatus({ workspaceId }).then((result) => {
    snapshotCache.set(workspaceId, {
      paths: result.paths,
      staged: result.staged ?? {},
      unstaged: result.unstaged ?? {},
      entries: result.entries ?? EMPTY_ENTRIES,
      context: result.context ?? EMPTY_CONTEXT
    });
  });
}

export function subscribeWorkspaceGitStatusPoll(
  workspaceId: string,
  listener: GitStatusListener
): () => void {
  let hub = hubs.get(workspaceId);
  if (!hub) {
    const cached = snapshotCache.get(workspaceId);
    hub = {
      refCount: 0,
      timer: null,
      treeUnsub: null,
      treeDebounceTimer: null,
      listeners: new Set(),
      snapshot: cached ? cloneSnapshot(cached) : { ...EMPTY_SNAPSHOT, entries: { ...EMPTY_ENTRIES } },
      inflight: false
    };
    hubs.set(workspaceId, hub);
  }

  hub.refCount += 1;
  hub.listeners.add(listener);
  listener(hub.snapshot);

  if (hub.refCount === 1) startHub(workspaceId, hub);

  return () => {
    const active = hubs.get(workspaceId);
    if (!active) return;
    active.listeners.delete(listener);
    active.refCount -= 1;
    if (active.refCount <= 0) stopHub(workspaceId, active);
  };
}

/** Drop cached git poll state when a workspace is removed from the registry. */
export function pruneWorkspaceGitStatusCache(workspaceId: string): void {
  snapshotCache.delete(workspaceId);
  const hub = hubs.get(workspaceId);
  if (hub) stopHub(workspaceId, hub);
}
