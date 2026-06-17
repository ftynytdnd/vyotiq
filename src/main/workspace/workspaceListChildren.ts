/**
 * Lazy per-folder workspace listing for the dock file tree.
 */

import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import { WORKSPACE_TREE_IGNORED_NAMES } from './workspaceTreeIgnore.js';
import { realpathInsideWorkspace } from '../tools/sandbox.js';

function sortWorkspaceChildEntries(entries: string[]): string[] {
  return [...entries].sort((a, b) => {
    const aDir = a.endsWith('/');
    const bDir = b.endsWith('/');
    if (aDir !== bDir) return aDir ? -1 : 1;
    const aName = a.endsWith('/') ? a.slice(0, -1) : a;
    const bName = b.endsWith('/') ? b.slice(0, -1) : b;
    const aBase = aName.split('/').pop() ?? aName;
    const bBase = bName.split('/').pop() ?? bName;
    return aBase.localeCompare(bBase);
  });
}

export async function listWorkspaceChildren(
  wsPath: string,
  relativeDir: string,
  includeDotfiles: boolean
): Promise<string[]> {
  const normDir = relativeDir.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/$/, '');
  const abs = normDir
    ? await realpathInsideWorkspace(wsPath, normDir)
    : resolve(wsPath);
  const dirents = await fs.readdir(abs, { withFileTypes: true });
  const entries: string[] = [];
  for (const ent of dirents) {
    const name = ent.name;
    if (!includeDotfiles && name.startsWith('.')) continue;
    if (WORKSPACE_TREE_IGNORED_NAMES.has(name)) continue;
    const rel = normDir ? `${normDir}/${name}` : name;
    if (ent.isDirectory()) {
      entries.push(`${rel}/`);
    } else if (ent.isFile()) {
      entries.push(rel);
    }
  }
  return sortWorkspaceChildEntries(entries);
}
