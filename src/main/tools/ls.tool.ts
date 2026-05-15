/**
 * `ls` tool — recursive directory listing scoped to the workspace.
 */

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Tool } from './types.js';
import type { ToolResult } from '@shared/types/tool.js';
import { resolveInsideWorkspace, workspaceRelative } from './sandbox.js';

interface LsArgs {
  path?: string;
  depth?: number;
  includeHidden?: boolean;
}

const DEFAULT_IGNORE = new Set(['node_modules', '.git', 'dist', 'out', '.next', '.turbo', '.cache']);
const MAX_ENTRIES = 500;

interface Entry {
  rel: string;
  type: 'file' | 'dir';
}

async function walk(
  rootAbs: string,
  startAbs: string,
  depth: number,
  includeHidden: boolean,
  out: Entry[]
): Promise<void> {
  if (out.length >= MAX_ENTRIES) return;
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(startAbs, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (out.length >= MAX_ENTRIES) return;
    if (!includeHidden && entry.name.startsWith('.')) continue;
    if (DEFAULT_IGNORE.has(entry.name)) continue;
    const childAbs = join(startAbs, entry.name);
    const rel = workspaceRelative(rootAbs, childAbs);
    if (entry.isDirectory()) {
      out.push({ rel: rel + '/', type: 'dir' });
      if (depth > 0) await walk(rootAbs, childAbs, depth - 1, includeHidden, out);
    } else if (entry.isFile()) {
      out.push({ rel, type: 'file' });
    }
  }
}

export const lsTool: Tool = {
  name: 'ls',
  briefMarkdown: `### Tool: \`ls\`

**WHAT it is.** A recursive directory lister scoped to the active workspace.

**HOW to use it.** Provide an optional \`path\` (default: workspace root) and an optional \`depth\` (default: 2).
\`\`\`json
{ "name": "ls", "arguments": { "path": "src", "depth": 3 } }
\`\`\`

**WHY it exists.** To map the project structure before reasoning about it. Cheaper than \`bash\` and produces stable, deterministic output.

**WHEN to trigger it.** As a first step in any task that requires understanding "what's here". Re-run after edits if structure changed materially.

**Notes.** \`node_modules\`, \`.git\`, \`dist\`, \`out\`, \`.next\` are skipped by default. Hidden files are skipped unless \`includeHidden: true\`. Capped at 500 entries.`,
  schema: {
    type: 'function',
    function: {
      name: 'ls',
      description:
        'Recursively list files and folders within the workspace. Skips node_modules, .git, dist, out, .next by default. Capped at 500 entries.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path relative to workspace root. Defaults to root.'
          },
          depth: {
            type: 'number',
            description: 'Recursion depth. Default 2.'
          },
          includeHidden: {
            type: 'boolean',
            description: 'Include dotfiles. Default false.'
          }
        }
      }
    }
  },
  async run(args, ctx): Promise<ToolResult> {
    const id = randomUUID();
    const started = Date.now();
    const a = args as LsArgs;
    const depth = typeof a.depth === 'number' ? Math.max(0, Math.min(8, a.depth)) : 2;
    const includeHidden = a.includeHidden === true;

    let startAbs: string;
    try {
      startAbs = resolveInsideWorkspace(ctx.workspacePath, a.path ?? '.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        id,
        name: 'ls',
        ok: false,
        output: `Sandbox error: ${msg}`,
        error: msg,
        durationMs: Date.now() - started
      };
    }

    let stat;
    try {
      stat = await fs.stat(startAbs);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        id,
        name: 'ls',
        ok: false,
        output: `Cannot stat ${a.path ?? '.'}: ${msg}`,
        error: msg,
        durationMs: Date.now() - started
      };
    }
    if (!stat.isDirectory()) {
      return {
        id,
        name: 'ls',
        ok: false,
        output: `Not a directory: ${a.path ?? '.'}`,
        error: 'not a directory',
        durationMs: Date.now() - started
      };
    }

    const out: Entry[] = [];
    await walk(ctx.workspacePath, startAbs, depth, includeHidden, out);
    const truncated = out.length >= MAX_ENTRIES;
    const lines = out.map((e) => (e.type === 'dir' ? `[D] ${e.rel}` : `[F] ${e.rel}`));
    const relPath = workspaceRelative(ctx.workspacePath, startAbs) || '.';
    const header = `# Listing of ${relPath} (depth ${depth})`;
    return {
      id,
      name: 'ls',
      ok: true,
      output: [header, ...lines, `--- ${out.length} entries ---`].join('\n'),
      data: {
        tool: 'ls',
        path: relPath,
        depth,
        entries: out.map((e) => ({ rel: e.rel, type: e.type })),
        truncated
      },
      durationMs: Date.now() - started
    };
  }
};
