/**
 * Poll git status for dock file tree badges when the Files panel is visible.
 */

import { useEffect, useState } from 'react';
import type { GitPathStatus, WorkspaceGitStatusResult, WorkspaceTreeChangedPayload } from '@shared/types/ipc.js';
import { vyotiq } from '../lib/ipc.js';

const POLL_MS = 5_000;

export function useWorkspaceGitStatus(
  workspaceId: string | null,
  enabled: boolean
): Record<string, GitPathStatus> {
  const [paths, setPaths] = useState<Record<string, GitPathStatus>>({});

  useEffect(() => {
    if (!workspaceId || !enabled) {
      setPaths({});
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const refresh = () => {
      void vyotiq.workspace
        .gitStatus({ workspaceId })
        .then((result: WorkspaceGitStatusResult) => {
          if (!cancelled) setPaths(result.paths);
        })
        .catch(() => {
          if (!cancelled) setPaths({});
        });
    };

    refresh();
    timer = setInterval(refresh, POLL_MS);
    const unsub = vyotiq.workspace.onTreeChanged((payload: WorkspaceTreeChangedPayload) => {
      if (payload.workspaceId === workspaceId) refresh();
    });

    return () => {
      cancelled = true;
      if (timer !== null) clearInterval(timer);
      unsub();
    };
  }, [workspaceId, enabled]);

  return paths;
}
