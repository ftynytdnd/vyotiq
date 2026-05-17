/**
 * Workspace IPC. Pick / get / set / list-tree (single-active back-compat)
 * + the multi-workspace registry surface (`workspaces:*`).
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
  retryWorkspaceReachability,
  setActiveWorkspace,
  setWorkspace
} from '../workspace/workspaceState.js';
import { bulkRemoveOrReparentByWorkspace } from '../conversations/conversationStore.js';
import { logger } from '../logging/logger.js';
import { wrapIpcHandler } from './wrapIpcHandler.js';
import { IpcCancelledError } from './ipcCancelledError.js';

const log = logger.child('ipc/workspace');

export function registerWorkspaceIpc(): void {
  wrapIpcHandler(IPC.WORKSPACE_GET, async () => getWorkspace());

  wrapIpcHandler(IPC.WORKSPACE_PICK, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Choose a workspace folder for Agent V',
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || result.filePaths.length === 0) {
      // F-020: align with the multi-workspace `WORKSPACES_ADD` channel
      // below, which already throws `workspace_add_cancelled`. The
      // pre-fix branch silently returned the previous workspace info,
      // which made it impossible for any future caller to distinguish
      // "user cancelled" from "user re-picked the active one". The
      // renderer's `useWorkspaceStore.pick()` already re-routes through
      // `add()`, so this legacy channel currently has no production
      // callers — alignment locks in a single mental model for any
      // future revival.
      log.info('workspace picker cancelled');
      throw new IpcCancelledError('workspace_pick_cancelled');
    }
    return setWorkspace(result.filePaths[0]!);
  });

  wrapIpcHandler(IPC.WORKSPACE_SET, async (_event, path: string) => setWorkspace(path));

  // ---- Multi-workspace registry ---------------------------------------
  wrapIpcHandler(IPC.WORKSPACES_LIST, async () => listWorkspaces());

  wrapIpcHandler(IPC.WORKSPACES_ADD, async (_event, path?: string) => {
    let resolved = path;
    if (!resolved) {
      const result = await dialog.showOpenDialog({
        title: 'Choose a workspace folder for Agent V',
        properties: ['openDirectory', 'createDirectory']
      });
      if (result.canceled || result.filePaths.length === 0) {
        log.info('workspace add picker cancelled');
        // Throw a friendly error so the renderer can suppress its
        // toast — caller catches and treats as a no-op. `IpcCancelledError`
        // is recognised by `wrapIpcHandler` and logged at `info`
        // (not `error`) so cancelled dialogs don't generate stack-traced
        // noise in `vyotiq.log`.
        throw new IpcCancelledError('workspace_add_cancelled');
      }
      resolved = result.filePaths[0]!;
    }
    return addWorkspace(resolved);
  });

  wrapIpcHandler(IPC.WORKSPACES_SET_ACTIVE, async (_event, id: string) => setActiveWorkspace(id));

  wrapIpcHandler(IPC.WORKSPACES_RETRY_REACHABILITY, async (_event, id: string) =>
    retryWorkspaceReachability(id)
  );

  wrapIpcHandler(IPC.WORKSPACES_RENAME, async (_event, id: string, label: string) =>
    renameWorkspace(id, label)
  );

  wrapIpcHandler(
    IPC.WORKSPACES_REMOVE,
    async (
      _event,
      id: string,
      opts: { deleteConversations: boolean }
    ) => {
      // Cascade conversations FIRST so the renderer's subsequent
      // `conversations.list()` reflects the post-cascade state. When
      // `deleteConversations: false` we reparent into the surviving
      // workspaces — pick the one that will become active after the
      // remove, so the orphaned chats don't disappear from the sidebar
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
      // id and become invisible in the sidebar until a new workspace
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
    async (_event, opts?: { depth?: number }): Promise<WorkspaceTreeResult> => {
      const ws = await getWorkspace();
      if (!ws.path) return { entries: [], truncated: false, total: 0 };
      const depth = Math.max(1, Math.min(6, opts?.depth ?? 3));
      const raw = await fg('**/*', {
        cwd: ws.path,
        ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/out/**', '**/.next/**'],
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
