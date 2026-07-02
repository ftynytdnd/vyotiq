/**
 * Poll git branch/dirty context for landing and shared status invoke.
 */

import { useEffect, useState } from 'react';
import type {
  GitFileState,
  GitPathStatus,
  WorkspaceGitContext
} from '@shared/types/ipc.js';
import {
  subscribeWorkspaceGitStatusPoll,
  type WorkspaceGitPollSnapshot
} from '../lib/workspaceGitStatusHub.js';

const EMPTY_CONTEXT: WorkspaceGitContext = {
  isRepo: false,
  branch: null,
  headShort: null,
  dirtyCount: 0,
  remote: null
};

const EMPTY_ENTRIES: Record<string, GitFileState> = {};

const EMPTY_SNAPSHOT: WorkspaceGitPollSnapshot = {
  paths: {},
  staged: {},
  unstaged: {},
  entries: EMPTY_ENTRIES,
  context: EMPTY_CONTEXT
};

export interface WorkspaceGitPollResult {
  paths: Record<string, GitPathStatus>;
  staged: Record<string, GitPathStatus>;
  unstaged: Record<string, GitPathStatus>;
  entries: Record<string, GitFileState>;
  context: WorkspaceGitContext;
}

export function useWorkspaceGitStatus(
  workspaceId: string | null,
  enabled: boolean
): WorkspaceGitPollResult {
  const [snapshot, setSnapshot] = useState<WorkspaceGitPollSnapshot>(EMPTY_SNAPSHOT);

  useEffect(() => {
    if (!workspaceId || !enabled) {
      setSnapshot(EMPTY_SNAPSHOT);
      return;
    }

    return subscribeWorkspaceGitStatusPoll(workspaceId, setSnapshot);
  }, [workspaceId, enabled]);

  return snapshot;
}

/** Landing-only accessor — same poll as dock git badges. */
export function useWorkspaceGitContext(
  workspaceId: string | null,
  enabled: boolean
): WorkspaceGitContext {
  return useWorkspaceGitStatus(workspaceId, enabled).context;
}
