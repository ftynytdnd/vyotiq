/**
 * Keep dock file-tree selection aligned with the active editor tab.
 */

import { useEffect } from 'react';
import { dockTreeRelativePath } from '../components/dock/dockFileTreeModel.js';
import { revealFileInDockTree } from '../lib/revealFileInDockTree.js';
import { normalizePath } from '../lib/normalizePath.js';
import { useEditorStore } from '../store/useEditorStore.js';
import { useDockFileTreeSelectionStore } from '../store/useDockFileTreeSelectionStore.js';

export function useDockEditorTreeSync(workspaceId: string | null, workspacePath: string): void {
  useEffect(() => {
    if (!workspaceId || !workspacePath) return;

    return useEditorStore.subscribe((state, prev) => {
      if (state.activeFilePath === prev.activeFilePath) return;
      if (!state.activeFilePath) return;

      const tab = state.tabs.find(
        (entry) =>
          entry.workspaceId === workspaceId &&
          normalizePath(entry.filePath) === normalizePath(state.activeFilePath!)
      );
      if (!tab) return;

      const relativePath = dockTreeRelativePath(tab.filePath, workspacePath);
      useDockFileTreeSelectionStore.getState().setWorkspaceSelection(workspaceId, [relativePath]);
      revealFileInDockTree(relativePath);
    });
  }, [workspaceId, workspacePath]);
}
