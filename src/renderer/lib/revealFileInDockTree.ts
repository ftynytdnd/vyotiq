/**
 * Reveal a workspace-relative path in the dock file tree.
 */

import { focusDockFilesPanel } from '../components/workbench/workbenchShared.js';
import { useUiStore } from '../store/useUiStore.js';
import { normalizeDockTreePath } from '../components/dock/dockFileTreeModel.js';

type RevealHandler = (relativePath: string) => void;

let revealHandler: RevealHandler | null = null;

export function registerDockFileTreeReveal(handler: RevealHandler | null): void {
  revealHandler = handler;
}

export function revealFileInDockTree(relativePath: string): void {
  const norm = normalizeDockTreePath(relativePath);
  if (!norm) return;
  useUiStore.getState().setDockExpanded(true);
  focusDockFilesPanel();
  revealHandler?.(norm);
}
