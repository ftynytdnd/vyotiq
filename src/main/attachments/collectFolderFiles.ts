/**
 * Recursively collect workspace-relative file paths under a folder,
 * respecting the same ignore list as `workspace:listTree`.
 */

import fg from 'fast-glob';
import { realpathInsideWorkspace } from '../tools/sandbox.js';
import { WORKSPACE_TREE_IGNORE } from '../workspace/workspaceTreeIgnore.js';

export interface CollectFolderFilesResult {
  /** Workspace-relative paths (forward slashes). */
  paths: string[];
  /** Total files found before the cap. */
  total: number;
  /** True when `total` exceeds `maxCount`. */
  truncated: boolean;
}

export async function collectFolderFiles(
  workspaceRoot: string,
  folderRelPath: string,
  maxCount: number
): Promise<CollectFolderFilesResult> {
  const normalized = folderRelPath.replace(/\\/g, '/').replace(/\/$/, '');
  await realpathInsideWorkspace(workspaceRoot, normalized || '.');

  const pattern = normalized ? `${normalized}/**/*` : '**/*';
  const raw = await fg(pattern, {
    cwd: workspaceRoot,
    ignore: [...WORKSPACE_TREE_IGNORE],
    onlyFiles: true,
    dot: false,
    followSymbolicLinks: false
  });

  const total = raw.length;
  const paths = raw.slice(0, maxCount);
  return { paths, total, truncated: total > maxCount };
}
