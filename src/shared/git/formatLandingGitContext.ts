/**
 * Landing git context line — workspace label + branch + dirty count.
 */

import type { WorkspaceGitContext } from '../types/ipc.js';
import { formatBranchSyncSuffix } from '../github/formatBranchSync.js';

function formatRefWithSync(context: WorkspaceGitContext): string {
  const ref = context.branch ?? context.headShort ?? 'HEAD';
  if (context.branch) {
    return `${ref}${formatBranchSyncSuffix(context.ahead, context.behind)}`;
  }
  return ref;
}

export function formatLandingGitContextLine(
  workspaceLabel: string,
  context: WorkspaceGitContext | null | undefined
): string {
  const label = workspaceLabel.trim() || 'workspace';
  if (!context?.isRepo) {
    return `${label} · not a git repository`;
  }
  const ref = formatRefWithSync(context);
  if (context.dirtyCount > 0) {
    const noun = context.dirtyCount === 1 ? 'change' : 'changes';
    return `${label} · ${ref} · ${context.dirtyCount} ${noun}`;
  }
  return `${label} · ${ref}`;
}

/** Compact VCS line for agent workspace envelope. */
export function formatWorkspaceVcsLine(context: WorkspaceGitContext): string {
  if (!context.isRepo) return 'VCS: not a git repository';
  const branchRef = context.branch
    ? `branch ${context.branch}${formatBranchSyncSuffix(context.ahead, context.behind)}`
    : `detached at ${context.headShort ?? 'HEAD'}`;
  if (context.dirtyCount > 0) {
    const noun = context.dirtyCount === 1 ? 'uncommitted change' : 'uncommitted changes';
    return `VCS: git on ${branchRef} (${context.dirtyCount} ${noun})`;
  }
  return `VCS: git on ${branchRef}`;
}
