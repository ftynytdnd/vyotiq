/**
 * `search` tool — local workspace grep.
 *
 * Fast-glob + line-grep across the workspace. The harness controls when to
 * invoke search. Local search is the default to honor "Offline first" and
 * the privacy directive.
 */

import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import fg from 'fast-glob';
import type { Tool } from './types.js';
import type { SearchMatch, ToolResult } from '@shared/types/tool.js';
import { realpathInsideWorkspace, workspaceRelative } from './sandbox.js';

interface SearchArgs {
  mode: 'local';
  query: string;
  path?: string;
  glob?: string;
  maxResults?: number;
}

const DEFAULT_GLOB = '**/*.{ts,tsx,js,jsx,md,mdx,json,css,scss,html,py,go,rs,java,cpp,c,h,hpp,toml,yml,yaml}';
const DEFAULT_IGNORE = ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/out/**', '**/.next/**'];

export const searchTool: Tool = {
  name: 'search',
  briefMarkdown: `### Tool: \`search\`

**WHAT it is.** Local grep across files in the workspace.

**HOW to use it.**

\`\`\`json
{ "name": "search", "arguments": { "mode": "local", "query": "createMainWindow", "glob": "src/**/*.ts" } }
\`\`\`

**WHY it exists.** Offline research is faster, private, and grounded in your codebase.

**WHEN to trigger it.** Use whenever you need to find a symbol or string in the project.`,
  schema: {
    type: 'function',
    function: {
      name: 'search',
      description: 'Local file grep across the workspace.',
      parameters: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['local'] },
          query: { type: 'string' },
          path: { type: 'string', description: 'Relative subpath to search.' },
          glob: { type: 'string', description: 'Glob filter.' },
          maxResults: { type: 'number' }
        },
        required: ['mode', 'query']
      }
    }
  },
  async run(args, ctx): Promise<ToolResult> {
    const id = randomUUID();
    const started = Date.now();
    const a = args as Partial<SearchArgs>;
    if (typeof a.query !== 'string' || !a.query.trim()) {
      return fail(id, started, 'Error: `query` is required.', 'missing query');
    }
    if (a.mode !== 'local') {
      return fail(
        id,
        started,
        `Error: unknown search mode "${String(a.mode)}" — use "local". Web search is not available.`,
        'invalid mode'
      );
    }
    const max = typeof a.maxResults === 'number' ? Math.max(1, Math.min(200, a.maxResults)) : 50;

    let rootAbs: string;
    try {
      rootAbs = await realpathInsideWorkspace(ctx.workspacePath, a.path ?? '.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return fail(id, started, `Sandbox error: ${msg}`, msg);
    }

    let files: string[];
    try {
      const stat = await fs.stat(rootAbs);
      if (stat.isFile()) {
        files = [rootAbs];
      } else if (stat.isDirectory()) {
        const glob = a.glob ?? DEFAULT_GLOB;
        try {
          files = await fg(glob, {
            cwd: rootAbs,
            ignore: DEFAULT_IGNORE,
            absolute: true,
            dot: false,
            onlyFiles: true,
            followSymbolicLinks: false
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return fail(id, started, `Glob error: ${msg}`, msg);
        }
      } else {
        return fail(
          id,
          started,
          `Path is neither file nor directory: ${a.path ?? '.'}`,
          'unsupported path type'
        );
      }
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === 'ENOENT') {
        return fail(id, started, `Path not found: ${a.path ?? '.'}`, 'path not found');
      }
      const msg = err instanceof Error ? err.message : String(err);
      return fail(id, started, `Stat error: ${msg}`, msg);
    }

    const re = buildLooseRegex(a.query);
    const matches: SearchMatch[] = [];
    let aborted = false;
    for (const file of files) {
      if (ctx.signal.aborted) {
        aborted = true;
        break;
      }
      if (matches.length >= max) break;
      let txt: string;
      try {
        txt = await fs.readFile(file, 'utf8');
      } catch {
        continue;
      }
      const rel = workspaceRelative(ctx.workspacePath, file);
      const lines = txt.split('\n');
      for (let i = 0; i < lines.length && matches.length < max; i++) {
        if (re.test(lines[i]!)) {
          matches.push({
            path: rel,
            line: i + 1,
            preview: lines[i]!.trim().slice(0, 240)
          });
        }
      }
    }
    if (aborted) {
      return fail(id, started, 'Local search aborted.', 'aborted');
    }
    const truncated = matches.length >= max;

    return {
      id,
      name: 'search',
      ok: true,
      output: matches.length > 0
        ? `# Local search for "${a.query}" — ${matches.length} hits${truncated ? ' (truncated)' : ''}\n` +
        matches.map((m) => `${m.path}:${m.line}\t${m.preview}`).join('\n')
        : `# No local matches for "${a.query}".`,
      data: {
        tool: 'search',
        mode: 'local',
        query: a.query,
        matches,
        truncated
      },
      durationMs: Date.now() - started
    };
  }
};

function buildLooseRegex(query: string): RegExp {
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escaped, 'i');
}

function fail(id: string, started: number, output: string, error: string): ToolResult {
  return { id, name: 'search', ok: false, output, error, durationMs: Date.now() - started };
}
