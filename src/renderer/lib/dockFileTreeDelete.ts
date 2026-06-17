/**
 * Shared delete + editor tab cleanup for dock file tree targets.
 */

import { vyotiq } from './ipc.js';
import { useEditorStore } from '../store/useEditorStore.js';
import type { DockTreeDeleteTarget } from './dockFileTreeSelection.js';

function tabsMatchingTarget(target: DockTreeDeleteTarget) {
  const prefix = target.path.replace(/\\/g, '/');
  return useEditorStore.getState().tabs.filter((tab) => {
    const p = tab.filePath.replace(/\\/g, '/');
    if (target.isDir) return p === prefix || p.startsWith(`${prefix}/`);
    return p === prefix;
  });
}

/** Close open editor tabs for a delete target; returns false if unsaved gate blocks. */
function closeTabsForDeleteTarget(target: DockTreeDeleteTarget): boolean {
  const tabs = tabsMatchingTarget(target);
  for (const tab of tabs) {
    const closed = useEditorStore.getState().requestCloseTab(tab.filePath);
    if (!closed) return false;
  }
  return true;
}

export function closeTabsForDeleteTargets(targets: readonly DockTreeDeleteTarget[]): boolean {
  for (const target of targets) {
    if (!closeTabsForDeleteTarget(target)) return false;
  }
  return true;
}

export async function deleteWorkspaceTargets(
  workspaceId: string,
  targets: readonly DockTreeDeleteTarget[]
): Promise<void> {
  for (const target of targets) {
    await vyotiq.workspace.deletePath({
      workspaceId,
      path: target.path,
      recursive: target.isDir
    });
  }
}

export function remainingTabsForTargets(targets: readonly DockTreeDeleteTarget[]) {
  return targets.flatMap((target) => tabsMatchingTarget(target));
}
