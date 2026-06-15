/**
 * Reorder editor tabs within one workspace while preserving global tab slots.
 */

import type { EditorTab } from '../store/useEditorStore.js';
import { normalizePath } from './normalizePath.js';

export function reorderWorkspaceTabs(
  allTabs: readonly EditorTab[],
  workspaceId: string,
  fromFilePath: string,
  toFilePath: string
): EditorTab[] {
  const fromId = normalizePath(fromFilePath);
  const toId = normalizePath(toFilePath);
  if (fromId === toId) return allTabs as EditorTab[];

  const workspaceTabs = allTabs.filter((tab) => tab.workspaceId === workspaceId);
  const fromIdx = workspaceTabs.findIndex((tab) => normalizePath(tab.filePath) === fromId);
  const toIdx = workspaceTabs.findIndex((tab) => normalizePath(tab.filePath) === toId);
  if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return allTabs as EditorTab[];

  const nextWorkspaceTabs = [...workspaceTabs];
  const [moved] = nextWorkspaceTabs.splice(fromIdx, 1);
  if (!moved) return allTabs as EditorTab[];
  nextWorkspaceTabs.splice(toIdx, 0, moved);

  let workspaceCursor = 0;
  return allTabs.map((tab) => {
    if (tab.workspaceId !== workspaceId) return tab;
    const next = nextWorkspaceTabs[workspaceCursor];
    workspaceCursor += 1;
    return next ?? tab;
  });
}
