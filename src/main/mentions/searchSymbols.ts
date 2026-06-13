/**
 * Lightweight workspace symbol search for composer @-mentions.
 */

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import fg from 'fast-glob';
import { WORKSPACE_TREE_IGNORE } from '../workspace/workspaceTreeIgnore.js';

export interface SymbolSearchHit {
  name: string;
  filePath: string;
  line: number;
}

const SYMBOL_RE =
  /^\s*(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|enum|const|let|var)\s+([A-Za-z_$][\w$]*)/;

const MAX_FILES = 120;
const MAX_HITS = 40;

export async function searchWorkspaceSymbols(
  workspacePath: string,
  query: string
): Promise<SymbolSearchHit[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const files = await fg(['**/*.{ts,tsx,js,jsx}'], {
    cwd: workspacePath,
    ignore: [...WORKSPACE_TREE_IGNORE],
    onlyFiles: true,
    deep: 5,
    dot: false,
    followSymbolicLinks: false
  });

  const hits: SymbolSearchHit[] = [];
  for (const rel of files.slice(0, MAX_FILES)) {
    let content: string;
    try {
      content = await fs.readFile(join(workspacePath, rel), 'utf8');
    } catch {
      continue;
    }
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = SYMBOL_RE.exec(lines[i] ?? '');
      if (!m?.[1]) continue;
      if (!m[1].toLowerCase().includes(q)) continue;
      hits.push({ name: m[1], filePath: rel.replace(/\\/g, '/'), line: i + 1 });
      if (hits.length >= MAX_HITS) return hits;
    }
  }
  return hits;
}
