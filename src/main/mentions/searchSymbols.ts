/**
 * Workspace symbol search for composer @-mentions — ast-grep structural patterns.
 */

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { findInFiles, pattern, Lang } from '@ast-grep/napi';
import fg from 'fast-glob';
import { workspaceRelative } from '../tools/sandbox.js';
import { WORKSPACE_TREE_IGNORE } from '../workspace/workspaceTreeIgnore.js';

export interface SymbolSearchHit {
  name: string;
  filePath: string;
  line: number;
}

const SYMBOL_PATTERNS = [
  'export function $NAME',
  'export async function $NAME',
  'export class $NAME',
  'export interface $NAME',
  'export type $NAME',
  'export const $NAME',
  'export let $NAME',
  'export enum $NAME',
  'function $NAME',
  'class $NAME'
] as const;

const MAX_FILES = 120;
const MAX_HITS = 40;
const SCAN_GLOB = '**/*.{ts,tsx,js,jsx}';

const SYMBOL_RE =
  /^\s*(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|enum|const|let|var)\s+([A-Za-z_$][\w$]*)/;

function extractNameFromMatch(text: string): string | null {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  const m =
    /(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|enum|const|let|var)\s+([A-Za-z_$][\w$]*)/.exec(
      trimmed
    );
  return m?.[1] ?? null;
}

export async function searchWorkspaceSymbols(
  workspacePath: string,
  query: string
): Promise<SymbolSearchHit[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const files = await fg([SCAN_GLOB], {
    cwd: workspacePath,
    ignore: [...WORKSPACE_TREE_IGNORE],
    onlyFiles: true,
    deep: 5,
    dot: false,
    followSymbolicLinks: false
  });

  if (files.length === 0) return [];

  const hits: SymbolSearchHit[] = [];
  const seen = new Set<string>();

  const addHit = (name: string, filePath: string, line: number): boolean => {
    if (!name.toLowerCase().includes(q)) return false;
    const key = `${filePath}:${name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    hits.push({ name, filePath, line });
    return hits.length >= MAX_HITS;
  };

  let napiFailed = false;
  for (const pat of SYMBOL_PATTERNS) {
    if (hits.length >= MAX_HITS) break;
    try {
      await findInFiles(
        Lang.TypeScript,
        {
          paths: [workspacePath],
          matcher: pattern(Lang.TypeScript, pat),
          languageGlobs: [SCAN_GLOB]
        },
        (err, nodes) => {
          if (err) {
            napiFailed = true;
            return;
          }
          if (nodes.length === 0) return;
          const absFile = nodes[0]!.getRoot().filename();
          const rel = workspaceRelative(workspacePath, absFile);
          for (const node of nodes) {
            if (hits.length >= MAX_HITS) return;
            const name = extractNameFromMatch(node.text());
            if (!name) continue;
            const range = node.range();
            if (addHit(name, rel, range.start.line + 1)) return;
          }
        }
      );
    } catch {
      napiFailed = true;
      break;
    }
  }

  if (!napiFailed && hits.length > 0) {
    return hits.slice(0, MAX_HITS);
  }

  for (const rel of files.slice(0, MAX_FILES)) {
    if (hits.length >= MAX_HITS) break;
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
      if (addHit(m[1], rel.replace(/\\/g, '/'), i + 1)) break;
    }
  }

  return hits;
}
