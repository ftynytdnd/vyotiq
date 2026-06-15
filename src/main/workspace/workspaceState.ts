/**
 * Workspace state — multi-workspace registry.
 *
 * The app supports many workspaces simultaneously. Each conversation is
 * stamped with a `workspaceId` and every orchestrator run pins the
 * workspace path it resolved at start, so changing the globally active
 * workspace mid-run can never affect that run's sandbox.
 *
 * On-disk shape (shared settings blob):
 *   {
 *     workspaces:        WorkspaceEntry[],   // authoritative registry
 *     activeWorkspaceId: string,             // currently-focused id
 *     workspacePath:     string?,            // legacy single-workspace
 *   }
 *
 * Migration: if `workspaces` is missing but `workspacePath` is present
 * (settings file from a pre-multi build), we synthesise a single entry
 * from it on `loadOnce()` and persist the modern shape. The legacy
 * field is preserved on disk for one cycle so any in-flight callers
 * still see something sensible; subsequent `setWorkspace` /
 * `setActiveWorkspace` calls clear it.
 *
 * Public API surface keeps the original three façades
 * (`getWorkspace` / `setWorkspace` / `requireWorkspace`) so every
 * existing tool/sandbox callsite stays compiling and behaviourally
 * identical — they read/write the *active* entry. New callers (the
 * orchestrator's per-run resolution, the workspaces dock tree)
 * use the explicit `*ById` variants.
 */

import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { basename } from 'node:path';
import type {
  WorkspaceEntry,
  WorkspaceInfo,
  WorkspacesState
} from '@shared/types/ipc.js';
import { readBlob, updateBlob } from '../settings/blob.js';
import { logger } from '../logging/logger.js';
import {
  disposeWorkspaceTreeWatcher,
  watchActiveWorkspace
} from './workspaceTreeWatcher.js';

const log = logger.child('workspace');

interface State {
  workspaces: WorkspaceEntry[];
  activeId: string | null;
}

let cached: State = { workspaces: [], activeId: null };
let loaded = false;
let loadPromise: Promise<void> | null = null;

/** Start or stop the filesystem watcher for the active workspace. */
function syncActiveWorkspaceWatcher(): void {
  const entry = cached.activeId ? findEntry(cached.activeId) : undefined;
  if (!entry || unreachable.has(entry.id)) {
    disposeWorkspaceTreeWatcher();
    return;
  }
  watchActiveWorkspace(entry.id, entry.path);
}

export function teardownWorkspaceTreeWatcher(): void {
  disposeWorkspaceTreeWatcher();
}

/**
 * Set of workspace ids whose path could not be statted on the most
 * recent `loadOnce()`. The id is preserved in the registry (so the
 * user can retry without re-picking) but is flagged as unreachable
 * for the renderer to surface a hint.
 */
const unreachable = new Set<string>();

async function loadOnce(): Promise<void> {
  if (loaded) return;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const blob = await readBlob();
    let workspaces: WorkspaceEntry[] = Array.isArray(blob.workspaces)
      ? blob.workspaces.filter(isValidEntry)
      : [];
    let activeId: string | null = blob.activeWorkspaceId ?? null;
    let migrated = false;

    // Legacy migration: synthesise an entry from `workspacePath`.
    if (workspaces.length === 0 && typeof blob.workspacePath === 'string' && blob.workspacePath.length > 0) {
      const entry: WorkspaceEntry = {
        id: randomUUID(),
        path: blob.workspacePath,
        label: basename(blob.workspacePath) || blob.workspacePath,
        addedAt: Date.now()
      };
      workspaces = [entry];
      activeId = entry.id;
      migrated = true;
      log.info('migrated legacy workspacePath to multi-workspace registry', {
        path: entry.path,
        id: entry.id
      });
    }

    // Sanity: drop a dangling activeId.
    if (activeId && !workspaces.some((w) => w.id === activeId)) {
      activeId = workspaces[0]?.id ?? null;
    }
    // Default the first registered workspace to active when nothing is set.
    if (!activeId && workspaces.length > 0) {
      activeId = workspaces[0]!.id;
    }

    // Stat every entry once so we can flag unreachable ones early. We
    // never drop the entry — preserve the registry so the user can
    // retry after the mount comes back, mirroring the prior single-
    // workspace contract.
    await Promise.all(
      workspaces.map(async (w) => {
        try {
          const stat = await fs.stat(w.path);
          if (!stat.isDirectory()) {
            log.warn('persisted workspace path is not a directory', { id: w.id, path: w.path });
            unreachable.add(w.id);
          }
        } catch {
          log.warn('persisted workspace path is unreachable; preserving for retry', {
            id: w.id,
            path: w.path
          });
          unreachable.add(w.id);
        }
      })
    );

    cached = { workspaces, activeId };
    loaded = true;

    if (migrated) {
      // Persist the modern shape immediately so subsequent boots skip
      // the migration branch. We DO leave `workspacePath` in place for
      // one cycle — the very next `setWorkspace` / `setActiveWorkspace`
      // call clears it (see `persist`).
      await updateBlob((current) => ({
        ...current,
        workspaces,
        activeWorkspaceId: activeId ?? undefined
      }));
    }
    syncActiveWorkspaceWatcher();
  })();
  return loadPromise;
}

function isValidEntry(e: unknown): e is WorkspaceEntry {
  return (
    typeof e === 'object' &&
    e !== null &&
    typeof (e as WorkspaceEntry).id === 'string' &&
    typeof (e as WorkspaceEntry).path === 'string' &&
    typeof (e as WorkspaceEntry).label === 'string' &&
    typeof (e as WorkspaceEntry).addedAt === 'number'
  );
}

/**
 * Re-persist the in-memory snapshot to the shared settings blob.
 *
 * Defensive belt-and-suspenders: every public mutator
 * (`addWorkspace`, `setActiveWorkspace`, `renameWorkspace`,
 * `removeWorkspace`) already calls `persistCandidate` BEFORE flipping
 * the cache, so disk and memory are aligned in the happy path. This
 * function is the safety net for the unhappy path:
 *
 *   - `loadOnce()` writes the migrated multi-workspace shape via
 *     `updateBlob` directly. If the process crashes between the
 *     migration write and a subsequent mutator, a small disk drift is
 *     possible (legacy `workspacePath` lingering, or a stale
 *     `activeWorkspaceId`).
 *   - Future async mutators that interleave between cache flip and a
 *     persist call would benefit from a final shutdown drain.
 *
 * Called once from the app's `before-quit` hook; idempotent and cheap
 * (`updateBlob` is debounced + atomic). Also exported for tests and
 * tooling that want to force a flush without going through a public
 * mutator.
 */
export async function flushWorkspaceState(): Promise<void> {
  // Skip a flush before `loadOnce()` has run — `cached` is the empty
  // sentinel `{workspaces: [], activeId: null}` and we'd clobber a
  // valid on-disk shape with empties on a crash that happens before
  // the boot finishes hydrating.
  if (!loaded) return;
  const snapshot = { workspaces: [...cached.workspaces], activeId: cached.activeId };
  await updateBlob((current) => ({
    ...current,
    workspaces: snapshot.workspaces,
    activeWorkspaceId: snapshot.activeId ?? undefined,
    // Drop the legacy field once the registry is authoritative.
    workspacePath: undefined
  }));
}

/**
 * Persist a candidate `(workspaces, activeId)` shape WITHOUT mutating
 * the in-memory cache first. Used by every public mutator
 * (`addWorkspace`, `setActiveWorkspace`, `removeWorkspace`,
 * `renameWorkspace`) so a settings disk-write failure leaves the
 * cache identical to its pre-call state. Callers commit to the cache
 * only AFTER this resolves successfully.
 */
async function persistCandidate(
  workspaces: WorkspaceEntry[],
  activeId: string | null
): Promise<void> {
  await updateBlob((current) => ({
    ...current,
    workspaces: [...workspaces],
    activeWorkspaceId: activeId ?? undefined,
    workspacePath: undefined
  }));
}

function findEntry(id: string): WorkspaceEntry | undefined {
  return cached.workspaces.find((w) => w.id === id);
}

function findEntryByPath(path: string): WorkspaceEntry | undefined {
  return cached.workspaces.find((w) => w.path === path);
}

function entryToInfo(entry: WorkspaceEntry | undefined): WorkspaceInfo {
  return entry ? { path: entry.path, label: entry.label } : { path: null, label: null };
}

// ---------------------------------------------------------------------------
// Multi-workspace surface (new callers)
// ---------------------------------------------------------------------------

export async function listWorkspaces(): Promise<WorkspacesState> {
  await loadOnce();
  return {
    activeId: cached.activeId,
    // Stamp the wire-level `unreachable` flag from the in-memory set
    // so the renderer can paint a warning chip. The flag is a derived
    // boot-time signal — it never persists to disk, so the registry
    // entry stays clean.
    workspaces: cached.workspaces.map((w) =>
      unreachable.has(w.id) ? { ...w, unreachable: true } : { ...w }
    )
  };
}

/**
 * Re-stat a workspace's path. On success, clear the `unreachable`
 * flag; on failure, keep it set. Returns the refreshed registry so
 * the caller (IPC handler) can hand the renderer a single fresh
 * snapshot. Idempotent and side-effect-free beyond the in-memory
 * `unreachable` set.
 */
export async function retryWorkspaceReachability(id: string): Promise<WorkspacesState> {
  await loadOnce();
  const entry = findEntry(id);
  if (!entry) throw new Error(`Unknown workspace id: ${id}`);
  try {
    const stat = await fs.stat(entry.path);
    if (stat.isDirectory()) {
      unreachable.delete(id);
      log.info('workspace reachability restored', { id, path: entry.path });
    } else {
      unreachable.add(id);
      log.warn('workspace path is not a directory on retry', { id, path: entry.path });
    }
  } catch {
    unreachable.add(id);
    log.warn('workspace path still unreachable on retry', { id, path: entry.path });
  }
  return listWorkspaces();
}

async function getWorkspaceById(id: string): Promise<WorkspaceEntry | null> {
  await loadOnce();
  const entry = findEntry(id);
  return entry ? { ...entry } : null;
}

/**
 * Resolves the workspace path for a given id, or throws if missing /
 * unregistered. Used by the orchestrator to pin a run's sandbox to its
 * conversation's workspace regardless of any later "active" change.
 */
export async function requireWorkspaceById(id: string): Promise<string> {
  const entry = await getWorkspaceById(id);
  if (!entry) {
    throw new Error(`Unknown workspace id: ${id}. Pick or add a workspace first.`);
  }
  return entry.path;
}

export async function getActiveWorkspace(): Promise<WorkspaceEntry | null> {
  await loadOnce();
  return cached.activeId ? findEntry(cached.activeId) ?? null : null;
}

export async function addWorkspace(path: string): Promise<WorkspaceEntry> {
  await loadOnce();
  const stat = await fs.stat(path);
  if (!stat.isDirectory()) {
    throw new Error(`Not a directory: ${path}`);
  }
  // Re-add of an existing path is a no-op activate — keeps the picker
  // / "Set workspace by path" flows idempotent.
  const existing = findEntryByPath(path);
  if (existing) {
    // Persist-then-commit ordering: build the candidate state
    // (re-activate existing entry) and only mutate `cached` after
    // `persistCandidate` resolves. Otherwise a transient write
    // failure would leave `cached.activeId` advertising a value
    // that never made it to disk.
    const candidateActive = existing.id;
    await persistCandidate(cached.workspaces, candidateActive);
    cached.activeId = candidateActive;
    unreachable.delete(existing.id);
    log.info('reactivated existing workspace by path', { id: existing.id, path });
    syncActiveWorkspaceWatcher();
    return { ...existing };
  }
  const entry: WorkspaceEntry = {
    id: randomUUID(),
    path,
    label: basename(path) || path,
    addedAt: Date.now()
  };
  const candidateWorkspaces = [entry, ...cached.workspaces];
  await persistCandidate(candidateWorkspaces, entry.id);
  cached.workspaces = candidateWorkspaces;
  cached.activeId = entry.id;
  unreachable.delete(entry.id);
  log.info('workspace added', { id: entry.id, path });
  syncActiveWorkspaceWatcher();
  return { ...entry };
}

export async function setActiveWorkspace(id: string): Promise<WorkspacesState> {
  await loadOnce();
  if (!findEntry(id)) {
    throw new Error(`Unknown workspace id: ${id}`);
  }
  if (cached.activeId === id) return listWorkspaces();
  await persistCandidate(cached.workspaces, id);
  cached.activeId = id;
  log.info('active workspace switched', { id });
  syncActiveWorkspaceWatcher();
  return listWorkspaces();
}

export async function renameWorkspace(id: string, label: string): Promise<WorkspaceEntry> {
  await loadOnce();
  const entry = findEntry(id);
  if (!entry) throw new Error(`Unknown workspace id: ${id}`);
  const next = label.trim().slice(0, 80);
  if (next.length === 0) throw new Error('Workspace label cannot be empty.');
  // Build the candidate workspaces list with the renamed entry, persist
  // it first, and only commit the in-memory mutation after success.
  const candidate: WorkspaceEntry = { ...entry, label: next };
  const candidateWorkspaces = cached.workspaces.map((w) => (w.id === id ? candidate : w));
  await persistCandidate(candidateWorkspaces, cached.activeId);
  cached.workspaces = candidateWorkspaces;
  return { ...candidate };
}

export async function removeWorkspace(id: string): Promise<WorkspacesState> {
  await loadOnce();
  const idx = cached.workspaces.findIndex((w) => w.id === id);
  if (idx < 0) return listWorkspaces();
  const candidateWorkspaces = cached.workspaces.filter((w) => w.id !== id);
  const candidateActive =
    cached.activeId === id ? candidateWorkspaces[0]?.id ?? null : cached.activeId;
  await persistCandidate(candidateWorkspaces, candidateActive);
  cached.workspaces = candidateWorkspaces;
  cached.activeId = candidateActive;
  unreachable.delete(id);
  log.info('workspace removed', { id });
  syncActiveWorkspaceWatcher();
  return listWorkspaces();
}

// ---------------------------------------------------------------------------
// Single-active façades (legacy callers — every existing tool/sandbox
// callsite reads through these and behaves identically to before).
// ---------------------------------------------------------------------------

/** Returns the active workspace's `WorkspaceInfo` (path may be null). */
export async function getWorkspace(): Promise<WorkspaceInfo> {
  const active = await getActiveWorkspace();
  return entryToInfo(active ?? undefined);
}

/**
 * Back-compat: "set the active workspace by path". Adds the path to
 * the registry if it's not already there, then activates it. The
 * `WorkspaceInfo` shape is preserved for callers that have not
 * migrated to the multi-workspace surface yet.
 */
export async function setWorkspace(path: string): Promise<WorkspaceInfo> {
  const entry = await addWorkspace(path);
  return entryToInfo(entry);
}

/**
 * Returns the active workspace's path, or throws if no workspace is
 * currently active. Used by tools that operate on "the workspace the
 * user is currently looking at" — orchestrator runs prefer
 * `requireWorkspaceById(workspaceId)` to pin to their bound
 * conversation's workspace.
 */
export async function requireWorkspace(): Promise<string> {
  const ws = await getWorkspace();
  if (!ws.path) {
    throw new Error('No workspace selected. Open Settings → pick a workspace folder.');
  }
  return ws.path;
}
