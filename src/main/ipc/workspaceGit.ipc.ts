/**
 * Workspace git mutation IPC — stage, commit, sync, stash, branches.
 */

import { IPC } from '@shared/constants.js';
import type {
  GitPathStatus,
  WorkspaceGitBranchesResult,
  WorkspaceGitCheckoutInput,
  WorkspaceGitCommitInput,
  WorkspaceGitCreateBranchInput,
  WorkspaceGitDiscardInput,
  WorkspaceGitGenerateMessageInput,
  WorkspaceGitGenerateMessageResult,
  WorkspaceGitOkResult,
  WorkspaceGitPathsInput,
  WorkspaceGitStashIndexInput,
  WorkspaceGitStashInput,
  WorkspaceGitStashListResult,
  WorkspaceGitSyncInput
} from '@shared/types/ipc.js';
import type { WorkspaceEntry } from '@shared/types/ipc.js';
import {
  listWorkspaces,
  requireWorkspaceById,
  updateWorkspaceGitHubBinding
} from '../workspace/workspaceState.js';
import {
  createWorkspaceGitRunner,
  notifyWorkspaceGitChanged
} from '../workspace/workspaceGitRunner.js';
import {
  gitCheckoutBranch,
  gitCommit,
  gitCreateBranch,
  gitCurrentBranch,
  gitDiscard,
  gitDiscardAll,
  gitFetch,
  gitListBranches,
  gitPull,
  gitPush,
  gitRemoteHasUpstream,
  gitResolveSyncRemote,
  gitStage,
  gitStageAll,
  gitStashDrop,
  gitStashList,
  gitStashPop,
  gitStashPush,
  gitUnstage,
  gitUnstageAll,
  resolveSyncBranchName
} from '../workspace/workspaceGitOps.js';
import { generateGitCommitMessage } from '../workspace/workspaceGitCommitMessage.js';
import { assertGitRemote, GitUserError, rethrowGitSyncError } from '../workspace/gitUserError.js';
import type { GitAuthorHints } from '../workspace/workspaceGitAuthor.js';
import { fetchAndCheckout } from '../github/gitRunner.js';
import { getGitHubAccountWithToken } from '../github/githubAccountsStore.js';
import { emitGitHubGitDone, gitProgressContext } from '../github/githubGitProgress.js';
import { assertSafeRelativePath } from '../workspace/workspacePathGuards.js';
import { wrapIpcHandler } from './wrapIpcHandler.js';
import {
  assertBoolean,
  assertEnum,
  assertNumber,
  assertObject,
  assertOptionalString,
  assertString,
  assertStringArray
} from './validate.js';

const MAX_PATH_BYTES = 4096;

async function resolveWorkspaceEntry(workspaceId: string): Promise<{
  wsPath: string;
  entry: WorkspaceEntry;
}> {
  const wsPath = await requireWorkspaceById(workspaceId);
  const entry = (await listWorkspaces()).workspaces.find((w) => w.id === workspaceId);
  if (!entry) throw new Error(`Unknown workspace id: ${workspaceId}`);
  return { wsPath, entry };
}

async function resolveGitAuthorHints(entry: WorkspaceEntry): Promise<GitAuthorHints | undefined> {
  if (!entry.github) return undefined;
  const account = await getGitHubAccountWithToken(entry.github.accountId);
  if (!account) return undefined;
  return {
    name: account.name ?? account.login,
    login: account.login
  };
}

function assertGitPaths(channel: string, paths: unknown): string[] {
  assertStringArray(channel, 'paths', paths, { maxBytes: MAX_PATH_BYTES });
  const out: string[] = [];
  for (let i = 0; i < paths.length; i++) {
    const p = paths[i]!;
    assertSafeRelativePath(channel, `paths[${i}]`, p, { allowDotVyotiq: true });
    out.push(p);
  }
  return out;
}

function assertDiscardPaths(
  channel: string,
  rows: unknown
): Array<{ path: string; status: GitPathStatus }> {
  if (!Array.isArray(rows)) {
    throw new Error(`${channel}: paths must be an array`);
  }
  const out: Array<{ path: string; status: GitPathStatus }> = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    assertObject(channel, `paths[${i}]`, row);
    const r = row as Record<string, unknown>;
    assertString(channel, `paths[${i}].path`, r.path, { maxBytes: MAX_PATH_BYTES });
    assertSafeRelativePath(channel, `paths[${i}].path`, r.path, { allowDotVyotiq: true });
    assertEnum(channel, `paths[${i}].status`, r.status, ['M', 'A', 'D', 'U', 'R', '?'] as const);
    out.push({ path: r.path as string, status: r.status as GitPathStatus });
  }
  return out;
}

async function afterGitMutation(workspaceId: string): Promise<WorkspaceGitOkResult> {
  notifyWorkspaceGitChanged(workspaceId);
  return { ok: true };
}

async function resolveSyncBranch(
  gitRun: Awaited<ReturnType<typeof createWorkspaceGitRunner>>,
  entry: WorkspaceEntry,
  branch?: string,
  opts?: { defaultBranch?: string }
): Promise<string> {
  return resolveSyncBranchName(gitRun, {
    branch,
    githubBranch: entry.github?.branch,
    defaultBranch: opts?.defaultBranch
  });
}

async function runGitSync<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    rethrowGitSyncError(err);
  }
}

async function checkoutWorkspaceBranch(
  workspaceId: string,
  branch: string
): Promise<WorkspaceGitOkResult> {
  const { wsPath, entry } = await resolveWorkspaceEntry(workspaceId);
  const nextBranch = branch.trim();
  if (!nextBranch) throw new Error('Branch name cannot be empty.');

  if (entry.github) {
    const account = await getGitHubAccountWithToken(entry.github.accountId);
    if (account) {
      const progress = gitProgressContext({
        workspaceId,
        owner: entry.github.owner,
        repo: entry.github.repo,
        branch: nextBranch
      });
      try {
        await fetchAndCheckout(wsPath, nextBranch, account.token, entry.github.host, progress);
      } finally {
        emitGitHubGitDone({
          workspaceId,
          owner: entry.github.owner,
          repo: entry.github.repo,
          branch: nextBranch,
          kind: 'fetch'
        });
      }
      await updateWorkspaceGitHubBinding(workspaceId, { ...entry.github, branch: nextBranch });
      return afterGitMutation(workspaceId);
    }
  }

  const gitRun = await createWorkspaceGitRunner(wsPath, entry);
  await gitCheckoutBranch(gitRun, nextBranch);
  return afterGitMutation(workspaceId);
}

export function registerWorkspaceGitIpc(): void {
  wrapIpcHandler(IPC.WORKSPACE_GIT_STAGE, async (_event, input: WorkspaceGitPathsInput) => {
    assertObject('workspace:git-stage', 'input', input);
    assertString('workspace:git-stage', 'workspaceId', input.workspaceId);
    if (input.all !== undefined) assertBoolean('workspace:git-stage', 'all', input.all);
    const { wsPath, entry } = await resolveWorkspaceEntry(input.workspaceId);
    const gitRun = await createWorkspaceGitRunner(wsPath, entry);
    if (input.all) {
      await gitStageAll(gitRun);
    } else {
      const paths = assertGitPaths('workspace:git-stage', input.paths ?? []);
      if (paths.length === 0) throw new Error('No paths to stage.');
      await gitStage(gitRun, paths);
    }
    return afterGitMutation(input.workspaceId);
  });

  wrapIpcHandler(IPC.WORKSPACE_GIT_UNSTAGE, async (_event, input: WorkspaceGitPathsInput) => {
    assertObject('workspace:git-unstage', 'input', input);
    assertString('workspace:git-unstage', 'workspaceId', input.workspaceId);
    if (input.all !== undefined) assertBoolean('workspace:git-unstage', 'all', input.all);
    const { wsPath, entry } = await resolveWorkspaceEntry(input.workspaceId);
    const gitRun = await createWorkspaceGitRunner(wsPath, entry);
    if (input.all) {
      await gitUnstageAll(gitRun);
    } else {
      const paths = assertGitPaths('workspace:git-unstage', input.paths ?? []);
      if (paths.length === 0) throw new Error('No paths to unstage.');
      await gitUnstage(gitRun, paths);
    }
    return afterGitMutation(input.workspaceId);
  });

  wrapIpcHandler(IPC.WORKSPACE_GIT_COMMIT, async (_event, input: WorkspaceGitCommitInput) => {
    assertObject('workspace:git-commit', 'input', input);
    assertString('workspace:git-commit', 'workspaceId', input.workspaceId);
    if (input.amend !== undefined) assertBoolean('workspace:git-commit', 'amend', input.amend);
    assertString('workspace:git-commit', 'message', input.message, {
      maxBytes: 8_192,
      nonEmpty: !input.amend
    });
    if (input.stageAllIfEmpty !== undefined) {
      assertBoolean('workspace:git-commit', 'stageAllIfEmpty', input.stageAllIfEmpty);
    }
    const { wsPath, entry } = await resolveWorkspaceEntry(input.workspaceId);
    const gitRun = await createWorkspaceGitRunner(wsPath, entry);
    const authorHints = await resolveGitAuthorHints(entry);
    await gitCommit(gitRun, input.message, {
      amend: input.amend,
      stageAllIfEmpty: input.stageAllIfEmpty ?? true,
      authorHints
    });
    return afterGitMutation(input.workspaceId);
  });

  wrapIpcHandler(IPC.WORKSPACE_GIT_FETCH, async (_event, input: { workspaceId: string }) => {
    assertObject('workspace:git-fetch', 'input', input);
    assertString('workspace:git-fetch', 'workspaceId', input.workspaceId);
    const { wsPath, entry } = await resolveWorkspaceEntry(input.workspaceId);
    const gitRun = await createWorkspaceGitRunner(wsPath, entry);
    const branch = await gitCurrentBranch(gitRun);
    const remote = await gitResolveSyncRemote(gitRun, branch);
    assertGitRemote(remote);
    await runGitSync(() => gitFetch(gitRun, remote));
    return afterGitMutation(input.workspaceId);
  });

  wrapIpcHandler(IPC.WORKSPACE_GIT_PULL, async (_event, input: WorkspaceGitSyncInput) => {
    assertObject('workspace:git-pull', 'input', input);
    assertString('workspace:git-pull', 'workspaceId', input.workspaceId);
    assertOptionalString('workspace:git-pull', 'branch', input.branch, { maxBytes: 256 });
    const { wsPath, entry } = await resolveWorkspaceEntry(input.workspaceId);
    const gitRun = await createWorkspaceGitRunner(wsPath, entry);
    const branch = await resolveSyncBranch(gitRun, entry, input.branch);
    const remote = await gitResolveSyncRemote(gitRun, branch);
    assertGitRemote(remote);
    await runGitSync(() => gitPull(gitRun, branch, remote));
    return afterGitMutation(input.workspaceId);
  });

  wrapIpcHandler(IPC.WORKSPACE_GIT_PUSH, async (_event, input: WorkspaceGitSyncInput) => {
    assertObject('workspace:git-push', 'input', input);
    assertString('workspace:git-push', 'workspaceId', input.workspaceId);
    assertOptionalString('workspace:git-push', 'branch', input.branch, { maxBytes: 256 });
    const { wsPath, entry } = await resolveWorkspaceEntry(input.workspaceId);
    const gitRun = await createWorkspaceGitRunner(wsPath, entry);
    const branch = await resolveSyncBranch(gitRun, entry, input.branch);
    const remote = await gitResolveSyncRemote(gitRun, branch);
    assertGitRemote(remote);
    const hasUpstream = await gitRemoteHasUpstream(gitRun, branch, remote);
    await runGitSync(() => gitPush(gitRun, branch, remote, !hasUpstream));
    return afterGitMutation(input.workspaceId);
  });

  wrapIpcHandler(IPC.WORKSPACE_GIT_DISCARD, async (_event, input: WorkspaceGitDiscardInput) => {
    assertObject('workspace:git-discard', 'input', input);
    assertString('workspace:git-discard', 'workspaceId', input.workspaceId);
    if (input.all !== undefined) assertBoolean('workspace:git-discard', 'all', input.all);
    const { wsPath, entry } = await resolveWorkspaceEntry(input.workspaceId);
    const gitRun = await createWorkspaceGitRunner(wsPath, entry);
    if (input.all) {
      await gitDiscardAll(gitRun);
    } else {
      const rows = assertDiscardPaths('workspace:git-discard', input.paths ?? []);
      if (rows.length === 0) throw new Error('No paths to discard.');
      for (const row of rows) {
        await gitDiscard(gitRun, row.path, row.status);
      }
    }
    return afterGitMutation(input.workspaceId);
  });

  wrapIpcHandler(IPC.WORKSPACE_GIT_STASH, async (_event, input: WorkspaceGitStashInput) => {
    assertObject('workspace:git-stash', 'input', input);
    assertString('workspace:git-stash', 'workspaceId', input.workspaceId);
    assertOptionalString('workspace:git-stash', 'message', input.message, { maxBytes: 512 });
    if (input.includeUntracked !== undefined) {
      assertBoolean('workspace:git-stash', 'includeUntracked', input.includeUntracked);
    }
    const { wsPath, entry } = await resolveWorkspaceEntry(input.workspaceId);
    const gitRun = await createWorkspaceGitRunner(wsPath, entry);
    const paths =
      input.paths && input.paths.length > 0
        ? assertGitPaths('workspace:git-stash', input.paths)
        : undefined;
    await gitStashPush(gitRun, {
      message: input.message,
      paths,
      includeUntracked: input.includeUntracked
    });
    return afterGitMutation(input.workspaceId);
  });

  wrapIpcHandler(
    IPC.WORKSPACE_GIT_STASH_POP,
    async (_event, input: WorkspaceGitStashIndexInput) => {
      assertObject('workspace:git-stash-pop', 'input', input);
      assertString('workspace:git-stash-pop', 'workspaceId', input.workspaceId);
      assertNumber('workspace:git-stash-pop', 'index', input.index, { min: 0 });
      const { wsPath, entry } = await resolveWorkspaceEntry(input.workspaceId);
      const gitRun = await createWorkspaceGitRunner(wsPath, entry);
      await gitStashPop(gitRun, input.index);
      return afterGitMutation(input.workspaceId);
    }
  );

  wrapIpcHandler(
    IPC.WORKSPACE_GIT_STASH_DROP,
    async (_event, input: WorkspaceGitStashIndexInput) => {
      assertObject('workspace:git-stash-drop', 'input', input);
      assertString('workspace:git-stash-drop', 'workspaceId', input.workspaceId);
      assertNumber('workspace:git-stash-drop', 'index', input.index, { min: 0 });
      const { wsPath, entry } = await resolveWorkspaceEntry(input.workspaceId);
      const gitRun = await createWorkspaceGitRunner(wsPath, entry);
      await gitStashDrop(gitRun, input.index);
      return afterGitMutation(input.workspaceId);
    }
  );

  wrapIpcHandler(
    IPC.WORKSPACE_GIT_STASH_LIST,
    async (_event, input: { workspaceId: string }): Promise<WorkspaceGitStashListResult> => {
      assertObject('workspace:git-stash-list', 'input', input);
      assertString('workspace:git-stash-list', 'workspaceId', input.workspaceId);
      const { wsPath, entry } = await resolveWorkspaceEntry(input.workspaceId);
      const gitRun = await createWorkspaceGitRunner(wsPath, entry);
      const stashes = await gitStashList(gitRun);
      return { stashes };
    }
  );

  wrapIpcHandler(
    IPC.WORKSPACE_GIT_BRANCHES,
    async (_event, input: { workspaceId: string }): Promise<WorkspaceGitBranchesResult> => {
      assertObject('workspace:git-branches', 'input', input);
      assertString('workspace:git-branches', 'workspaceId', input.workspaceId);
      const { wsPath, entry } = await resolveWorkspaceEntry(input.workspaceId);
      const gitRun = await createWorkspaceGitRunner(wsPath, entry);
      const branches = await gitListBranches(gitRun);
      return { branches };
    }
  );

  wrapIpcHandler(IPC.WORKSPACE_GIT_CHECKOUT, async (_event, input: WorkspaceGitCheckoutInput) => {
    assertObject('workspace:git-checkout', 'input', input);
    assertString('workspace:git-checkout', 'workspaceId', input.workspaceId);
    assertString('workspace:git-checkout', 'branch', input.branch, { maxBytes: 256 });
    return checkoutWorkspaceBranch(input.workspaceId, input.branch);
  });

  wrapIpcHandler(
    IPC.WORKSPACE_GIT_CREATE_BRANCH,
    async (_event, input: WorkspaceGitCreateBranchInput) => {
      assertObject('workspace:git-create-branch', 'input', input);
      assertString('workspace:git-create-branch', 'workspaceId', input.workspaceId);
      assertString('workspace:git-create-branch', 'branch', input.branch, { maxBytes: 256 });
      if (input.checkout !== undefined) {
        assertBoolean('workspace:git-create-branch', 'checkout', input.checkout);
      }
      const { wsPath, entry } = await resolveWorkspaceEntry(input.workspaceId);
      const gitRun = await createWorkspaceGitRunner(wsPath, entry);
      await gitCreateBranch(gitRun, input.branch, input.checkout ?? true);
      if (entry.github && (input.checkout ?? true)) {
        await updateWorkspaceGitHubBinding(input.workspaceId, {
          ...entry.github,
          branch: input.branch.trim()
        });
      }
      return afterGitMutation(input.workspaceId);
    }
  );

  wrapIpcHandler(
    IPC.WORKSPACE_GIT_GENERATE_COMMIT_MESSAGE,
    async (
      event,
      input: WorkspaceGitGenerateMessageInput
    ): Promise<WorkspaceGitGenerateMessageResult> => {
      assertObject('workspace:git-generate-commit-message', 'input', input);
      assertString('workspace:git-generate-commit-message', 'workspaceId', input.workspaceId);
      assertString('workspace:git-generate-commit-message', 'requestId', input.requestId, {
        maxBytes: 128
      });
      const { wsPath, entry } = await resolveWorkspaceEntry(input.workspaceId);
      const gitRun = await createWorkspaceGitRunner(wsPath, entry);
      try {
        const result = await generateGitCommitMessage(gitRun, input.workspaceId, wsPath, {
          onDelta: (delta) => {
            if (event.sender.isDestroyed()) return;
            try {
              event.sender.send(IPC.WORKSPACE_GIT_COMMIT_MESSAGE_DELTA, {
                requestId: input.requestId,
                delta
              });
            } catch {
              // renderer gone mid-stream
            }
          }
        });
        return {
          message: result.message,
          warnings: result.warnings.length > 0 ? result.warnings : undefined
        };
      } catch (err) {
        if (err instanceof GitUserError) {
          return { message: '', error: err.message };
        }
        throw err;
      }
    }
  );
}
