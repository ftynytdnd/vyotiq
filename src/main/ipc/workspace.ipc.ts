/**
 * Workspace IPC — directory picker, list-tree, and multi-workspace registry (`workspaces:*`).
 */

import { dialog } from 'electron';
import fg from 'fast-glob';
import { IPC } from '@shared/constants.js';
import type { WorkspaceTreeResult } from '@shared/types/ipc.js';
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
import { WORKSPACE_TREE_IGNORE } from '../workspace/workspaceTreeIgnore.js';
import { logger } from '../logging/logger.js';
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
    return addWorkspace(resolved);
  });

  wrapIpcHandler(IPC.WORKSPACES_SET_ACTIVE, async (_event, id: string) => {
    assertString('workspaces:setActive', 'id', id);
    return setActiveWorkspace(id);
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
        log.warn('workspace tree truncated', { total, cap: MAX_TREE_ENTRIES });
      }
      const entries = indexed.slice(0, MAX_TREE_ENTRIES).map((e) => e.p);
      return { entries, truncated, total };
    }
  );
}
