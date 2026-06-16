/**
 * Workspace IPC — directory picker, list-tree, and multi-workspace registry (`workspaces:*`).
 */

import { dialog, shell } from 'electron';
import fg from 'fast-glob';
import { promises as fs } from 'node:fs';
import { relative, resolve } from 'node:path';
import { IPC, WORKSPACE_DOTDIR } from '@shared/constants.js';
import type {
  WorkspaceDeletePathInput,
  WorkspaceListChildrenInput,
  WorkspaceListChildrenResult,
  WorkspaceMkdirInput,
  WorkspacePathOpReply,
  WorkspaceRenamePathInput,
  WorkspaceRevealPathInput,
  WorkspaceTreeResult
} from '@shared/types/ipc.js';
import {
  addWorkspace,
  getWorkspace,
  listWorkspaces,
  removeWorkspace,
  renameWorkspace,
  requireWorkspaceById,
  retryWorkspaceReachability,
  setActiveWorkspace
} from '../workspace/workspaceState.js';
import { bulkRemoveOrReparentByWorkspace } from '../conversations/conversationStore.js';
import {
  disposeWorkspaceVectorIndex,
  scheduleWorkspaceVectorIndex
} from '../memory/vector/indexScheduler.js';
import { killWorkspacePty } from '../terminal/ptyManager.js';
import { disposeLspSession } from '../lsp/lspManager.js';
import { WORKSPACE_TREE_IGNORE } from '../workspace/workspaceTreeIgnore.js';
import { listWorkspaceChildren } from '../workspace/workspaceListChildren.js';
import { getWorkspaceGitStatus } from '../workspace/workspaceGitStatus.js';
import { emitWorkspaceTreeChanged } from '../workspace/workspaceTreeWatcher.js';
import { assertSafeRelativePath } from '../workspace/workspacePathGuards.js';
import { realpathInsideWorkspace, resolveInsideWorkspace } from '../tools/sandbox.js';
import { logger } from '../logging/logger.js';
import { shouldLogRepeatedPollWarning } from '../providers/providerPollLogThrottle.js';
import { wrapIpcHandler } from './wrapIpcHandler.js';
// Audit fix 2026-06-P2-1 — runtime shape gates for workspace-channel
// payloads. Path strings are capped at 4 KB (well above any
// realistic OS path) and id strings keep the default 1 KB cap.
import {
  assertString,
  assertOptionalString,
  assertObject,
  assertNumber,
  assertBoolean
} from './validate.js';

const log = logger.child('ipc/workspace');

async function pickDirectoryPath(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: 'Choose a workspace folder for Agent V',
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) {
    log.info('workspace picker cancelled');
    return null;
  }
  return result.filePaths[0]!;
}

// Hard cap on filesystem paths arriving over IPC. Windows PATH_MAX is
// 32 767 chars in long-path mode but no legitimate workspace root
// ever approaches that — capping at 4 KB matches the `providers`
// baseUrl ceiling and forecloses pathological inputs.
const MAX_PATH_BYTES = 4096;

async function resolveWorkspaceForPathOps(workspaceId: string | undefined): Promise<{
  wsPath: string;
  workspaceId: string;
}> {
  if (workspaceId) {
    const wsPath = await requireWorkspaceById(workspaceId);
    const entry = (await listWorkspaces()).workspaces.find((w) => w.id === workspaceId);
    if (!entry) throw new Error(`Unknown workspace id: ${workspaceId}`);
    return { wsPath, workspaceId: entry.id };
  }
  const ws = await getWorkspace();
  if (!ws.path) throw new Error('No workspace bound.');
  const state = await listWorkspaces();
  if (!state.activeId) throw new Error('No workspace bound.');
  return { wsPath: ws.path, workspaceId: state.activeId };
}

function isWorkspaceRootPath(wsPath: string, abs: string): boolean {
  return resolve(wsPath) === resolve(abs);
}

async function emitTreeChangedForWorkspace(workspaceId: string, wsPath: string): Promise<void> {
  emitWorkspaceTreeChanged(workspaceId);
  scheduleWorkspaceVectorIndex(wsPath);
}

export function registerWorkspaceIpc(): void {
  wrapIpcHandler(IPC.WORKSPACE_PICK_DIRECTORY, async (): Promise<string | null> => {
    return pickDirectoryPath();
  });

  // ---- Multi-workspace registry ---------------------------------------
  wrapIpcHandler(IPC.WORKSPACES_LIST, async () => listWorkspaces());

  wrapIpcHandler(IPC.WORKSPACES_ADD, async (_event, path?: string) => {
    // `path` is optional — when omitted the dialog runs. Validate only
    // the populated case so a folder picker call still passes.
    assertOptionalString('workspaces:add', 'path', path, { maxBytes: MAX_PATH_BYTES });
    let resolved = path;
    if (!resolved) {
      const result = await dialog.showOpenDialog({
        title: 'Choose a workspace folder for Agent V',
        properties: ['openDirectory', 'createDirectory']
      });
      if (result.canceled || result.filePaths.length === 0) {
        // Return null (do not throw) — renderer treats as no-op; avoids
        // Electron's stderr "Error occurred in handler" on dismiss.
        log.info('workspace add picker cancelled');
        return null;
      }
      resolved = result.filePaths[0]!;
    }
    const entry = await addWorkspace(resolved);
    scheduleWorkspaceVectorIndex(entry.path);
    return entry;
  });

  wrapIpcHandler(IPC.WORKSPACES_SET_ACTIVE, async (_event, id: string) => {
    assertString('workspaces:setActive', 'id', id);
    const state = await setActiveWorkspace(id);
    const active = state.workspaces.find((w) => w.id === state.activeId);
    if (active) scheduleWorkspaceVectorIndex(active.path);
    return state;
  });

  wrapIpcHandler(IPC.WORKSPACES_RETRY_REACHABILITY, async (_event, id: string) => {
    assertString('workspaces:retryReachability', 'id', id);
    return retryWorkspaceReachability(id);
  });

  wrapIpcHandler(IPC.WORKSPACES_RENAME, async (_event, id: string, label: string) => {
    assertString('workspaces:rename', 'id', id);
    // Sidebar labels cap visually at ~30 chars; 256 B keeps room for
    // unicode without rejecting any legitimate input.
    assertString('workspaces:rename', 'label', label, { maxBytes: 256 });
    return renameWorkspace(id, label);
  });

  wrapIpcHandler(
    IPC.WORKSPACES_REMOVE,
    async (
      _event,
      id: string,
      opts: { deleteConversations: boolean }
    ) => {
      assertString('workspaces:remove', 'id', id);
      assertObject('workspaces:remove', 'opts', opts);
      if ('deleteConversations' in opts && opts.deleteConversations !== undefined) {
        assertBoolean('workspaces:remove', 'opts.deleteConversations', opts.deleteConversations);
      }
      // `opts.deleteConversations` IS allowed to be undefined / other
      // shapes inside the body below (it short-circuits to the
      // reparent branch). No further validation needed.
      // Cascade conversations FIRST so the renderer's subsequent
      // `conversations.list()` reflects the post-cascade state. When
      // `deleteConversations: false` we reparent into the surviving
      // workspaces — pick the one that will become active after the
      // remove, so the orphaned chats don't disappear from the dock
      // tree.
      const before = await listWorkspaces();
      const doomed = before.workspaces.find((w) => w.id === id);
      const remaining = before.workspaces.filter((w) => w.id !== id);
      if (opts?.deleteConversations === true) {
        await bulkRemoveOrReparentByWorkspace(id, { type: 'delete' });
      } else if (remaining.length > 0) {
        await bulkRemoveOrReparentByWorkspace(id, {
          type: 'reparent',
          targetWorkspaceId: remaining[0]!.id
        });
      }
      // If `remaining.length === 0` the user is removing their last
      // workspace; the conversations stay stamped with the now-defunct
      // id and become invisible in the dock until a new workspace
      // is added (at which point they'll be reparented by the next
      // boot's migration, since `workspaceId` no longer matches any
      // registered entry). This is intentional — destroying the only
      // workspace SHOULD wipe the slate visually.
      // tear down per-workspace vector db + in-flight indexer
      if (doomed) void disposeWorkspaceVectorIndex(doomed.path);
      killWorkspacePty(id);
      await disposeLspSession(id);
      return removeWorkspace(id);
    }
  );

  // Hard cap on returned entries — large monorepos can otherwise produce
  // tens of thousands of paths, which the renderer's attachment picker
  // virtualization isn't built for. 800 is enough for any realistic
  // single-feature workspace and well within the picker's render budget.
  const MAX_TREE_ENTRIES = 800;

  wrapIpcHandler(
    IPC.WORKSPACE_LIST_TREE,
    async (_event, opts?: { depth?: number; workspaceId?: string }): Promise<WorkspaceTreeResult> => {
      // `opts` is optional; only inspect when present. Cap depth at 6
      // — the same hard ceiling the body below enforces via Math.min,
      // restated here so a hand-crafted malformed `depth` (NaN,
      // Infinity, negative) rejects at the boundary instead of
      // silently clamping inside the handler.
      if (opts !== undefined) {
        assertObject('workspace:listTree', 'opts', opts);
        if (opts.depth !== undefined) {
          assertNumber('workspace:listTree', 'opts.depth', opts.depth, {
            integer: true,
            min: 1,
            max: 6
          });
        }
        if (opts.workspaceId !== undefined) {
          assertString('workspace:listTree', 'opts.workspaceId', opts.workspaceId);
        }
      }
      let wsPath: string | null = null;
      if (opts?.workspaceId) {
        try {
          wsPath = await requireWorkspaceById(opts.workspaceId);
        } catch (err: unknown) {
          log.warn('workspace:listTree unknown workspaceId', {
            workspaceId: opts.workspaceId,
            err: err instanceof Error ? err.message : String(err)
          });
          return { entries: [], truncated: false, total: 0 };
        }
      } else {
        const ws = await getWorkspace();
        wsPath = ws.path;
      }
      if (!wsPath) return { entries: [], truncated: false, total: 0 };
      const depth = Math.max(1, Math.min(6, opts?.depth ?? 3));
      const raw = await fg('**/*', {
        cwd: wsPath,
        ignore: [...WORKSPACE_TREE_IGNORE],
        onlyFiles: false,
        markDirectories: true,
        deep: depth,
        dot: false,
        // Do NOT enumerate through workspace-rooted symlinks. fast-glob
        // defaults to following them, which would surface external
        // trees (`vendor -> /etc`) inside the attachment picker. That,
        // combined with any path-resolution gap on the consumer side,
        // is the simplest route to a privacy leak — `inlineFiles` now
        // uses realpath containment as defense-in-depth, but keeping
        // the listing itself symlink-bounded means the picker never
        // even shows external paths to begin with.
        followSymbolicLinks: false
      });
      // Bias the kept slice toward shallow entries. `fast-glob` returns
      // results alphabetically, so on a large monorepo the cap would
      // bite `src/` / `tests/` (which sort late) before chopping the
      // massive leaf lists the user almost never attaches. We sort by
      // segment count first (shallow → deep), breaking ties on the
      // original order, and THEN apply the cap. Net effect: the picker
      // never loses the top-level folders users actually reach for.
      const indexed = raw.map((p, i) => ({ p, i, depthScore: p.split('/').length }));
      indexed.sort((a, b) =>
        a.depthScore !== b.depthScore ? a.depthScore - b.depthScore : a.i - b.i
      );
      const total = indexed.length;
      const truncated = total > MAX_TREE_ENTRIES;
      if (truncated) {
        const logKey = `workspace-tree-truncated:${wsPath}`;
        const message = `workspace tree truncated total=${total} cap=${MAX_TREE_ENTRIES}`;
        if (shouldLogRepeatedPollWarning(logKey, message)) {
          log.warn('workspace tree truncated', { total, cap: MAX_TREE_ENTRIES });
        }
      }
      const entries = indexed.slice(0, MAX_TREE_ENTRIES).map((e) => e.p);
      return { entries, truncated, total };
    }
  );

  wrapIpcHandler(
    IPC.WORKSPACE_LIST_CHILDREN,
    async (_event, input: WorkspaceListChildrenInput): Promise<WorkspaceListChildrenResult> => {
      assertObject('workspace:listChildren', 'input', input);
      assertString('workspace:listChildren', 'input.relativeDir', input.relativeDir, {
        maxBytes: MAX_PATH_BYTES,
        nonEmpty: false
      });
      assertOptionalString('workspace:listChildren', 'input.workspaceId', input.workspaceId);
      if (input.includeDotfiles !== undefined) {
        assertBoolean('workspace:listChildren', 'input.includeDotfiles', input.includeDotfiles);
      }
      const relativeDir = input.relativeDir.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/$/, '');
      if (relativeDir) {
        assertSafeRelativePath('workspace:listChildren', 'input.relativeDir', relativeDir);
      }
      let wsPath: string | null = null;
      if (input.workspaceId) {
        try {
          wsPath = await requireWorkspaceById(input.workspaceId);
        } catch (err: unknown) {
          log.warn('workspace:listChildren unknown workspaceId', {
            workspaceId: input.workspaceId,
            err: err instanceof Error ? err.message : String(err)
          });
          return { entries: [] };
        }
      } else {
        const ws = await getWorkspace();
        wsPath = ws.path;
      }
      if (!wsPath) return { entries: [] };
      const entries = await listWorkspaceChildren(
        wsPath,
        relativeDir,
        input.includeDotfiles ?? true
      );
      return { entries };
    }
  );

  wrapIpcHandler(
    IPC.WORKSPACE_GIT_STATUS,
    async (_event, opts?: { workspaceId?: string }) => {
      if (opts !== undefined) {
        assertObject('workspace:gitStatus', 'opts', opts);
        if (opts.workspaceId !== undefined) {
          assertString('workspace:gitStatus', 'opts.workspaceId', opts.workspaceId);
        }
      }
      let wsPath: string | null = null;
      if (opts?.workspaceId) {
        try {
          wsPath = await requireWorkspaceById(opts.workspaceId);
        } catch {
          return { paths: {} };
        }
      } else {
        const ws = await getWorkspace();
        wsPath = ws.path;
      }
      if (!wsPath) return { paths: {} };
      const paths = await getWorkspaceGitStatus(wsPath);
      return { paths };
    }
  );

  wrapIpcHandler(
    IPC.WORKSPACE_MKDIR,
    async (_event, input: WorkspaceMkdirInput): Promise<WorkspacePathOpReply> => {
      assertObject('workspace:mkdir', 'input', input);
      assertString('workspace:mkdir', 'path', input.path, { maxBytes: MAX_PATH_BYTES });
      assertOptionalString('workspace:mkdir', 'workspaceId', input.workspaceId);
      assertSafeRelativePath('workspace:mkdir', 'path', input.path);
      const { wsPath, workspaceId } = await resolveWorkspaceForPathOps(input.workspaceId);
      const abs = await realpathInsideWorkspace(wsPath, input.path);
      await fs.mkdir(abs, { recursive: true });
      await emitTreeChangedForWorkspace(workspaceId, wsPath);
      return { ok: true };
    }
  );

  wrapIpcHandler(
    IPC.WORKSPACE_RENAME_PATH,
    async (_event, input: WorkspaceRenamePathInput): Promise<WorkspacePathOpReply> => {
      assertObject('workspace:rename-path', 'input', input);
      assertString('workspace:rename-path', 'from', input.from, { maxBytes: MAX_PATH_BYTES });
      assertString('workspace:rename-path', 'to', input.to, { maxBytes: MAX_PATH_BYTES });
      assertOptionalString('workspace:rename-path', 'workspaceId', input.workspaceId);
      assertSafeRelativePath('workspace:rename-path', 'from', input.from);
      assertSafeRelativePath('workspace:rename-path', 'to', input.to);
      const { wsPath, workspaceId } = await resolveWorkspaceForPathOps(input.workspaceId);
      const fromAbs = await realpathInsideWorkspace(wsPath, input.from);
      if (isWorkspaceRootPath(wsPath, fromAbs)) {
        throw new Error('Cannot rename the workspace root.');
      }
      const toLex = resolveInsideWorkspace(wsPath, input.to);
      try {
        await fs.access(toLex);
        throw new Error(`Destination already exists: ${input.to}`);
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
      }
      await fs.rename(fromAbs, toLex);
      await emitTreeChangedForWorkspace(workspaceId, wsPath);
      return { ok: true };
    }
  );

  wrapIpcHandler(
    IPC.WORKSPACE_DELETE_PATH,
    async (_event, input: WorkspaceDeletePathInput): Promise<WorkspacePathOpReply> => {
      assertObject('workspace:delete-path', 'input', input);
      assertString('workspace:delete-path', 'path', input.path, { maxBytes: MAX_PATH_BYTES });
      assertOptionalString('workspace:delete-path', 'workspaceId', input.workspaceId);
      if (input.recursive !== undefined) {
        assertBoolean('workspace:delete-path', 'recursive', input.recursive);
      }
      assertSafeRelativePath('workspace:delete-path', 'path', input.path);
      const { wsPath, workspaceId } = await resolveWorkspaceForPathOps(input.workspaceId);
      const abs = await realpathInsideWorkspace(wsPath, input.path);
      if (isWorkspaceRootPath(wsPath, abs)) {
        throw new Error('Cannot delete the workspace root.');
      }
      const rel = relative(resolve(wsPath), abs).replace(/\\/g, '/');
      if (rel === WORKSPACE_DOTDIR || rel.startsWith(`${WORKSPACE_DOTDIR}/`)) {
        throw new Error(`Cannot delete ${WORKSPACE_DOTDIR} metadata.`);
      }
      const st = await fs.stat(abs);
      if (st.isDirectory()) {
        await fs.rm(abs, { recursive: input.recursive === true, force: true });
      } else {
        await fs.unlink(abs);
      }
      await emitTreeChangedForWorkspace(workspaceId, wsPath);
      return { ok: true };
    }
  );

  wrapIpcHandler(
    IPC.WORKSPACE_REVEAL_PATH,
    async (_event, input: WorkspaceRevealPathInput): Promise<WorkspacePathOpReply> => {
      assertObject('workspace:reveal-path', 'input', input);
      assertString('workspace:reveal-path', 'path', input.path, { maxBytes: MAX_PATH_BYTES });
      assertOptionalString('workspace:reveal-path', 'workspaceId', input.workspaceId);
      assertSafeRelativePath('workspace:reveal-path', 'path', input.path);
      const { wsPath } = await resolveWorkspaceForPathOps(input.workspaceId);
      const abs = await realpathInsideWorkspace(wsPath, input.path);
      shell.showItemInFolder(abs);
      return { ok: true };
    }
  );
}
