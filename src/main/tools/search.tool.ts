/**
 * `search` tool — local workspace grep + ast-grep structural search.
 */

import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import fg from 'fast-glob';
import type { Tool } from './types.js';
import type { SearchMatch, ToolResult } from '@shared/types/tool.js';
import { realpathInsideWorkspace, workspaceRelative } from './sandbox.js';
import { runStructuralSearch } from './structuralSearch.js';

type SearchMode = 'local' | 'structural';

interface SearchArgs {
  mode: SearchMode;
  query: string;
  path?: string;
  glob?: string;
  maxResults?: number;
  /** ast-grep pattern (structural mode). Defaults to `query` when omitted. */
  pattern?: string;
  /** ast-grep language id (structural mode). */
  language?: string;
}

const DEFAULT_GLOB = '**/*.{ts,tsx,js,jsx,md,mdx,json,css,scss,html,py,go,rs,java,cpp,c,h,hpp,toml,yml,yaml}';
const DEFAULT_IGNORE = ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/out/**', '**/.next/**'];

export const searchTool: Tool = {
  name: 'search',
  briefMarkdown: `### Tool: \`search\`

**WHAT it is.** Local codebase search: line grep (\`mode: "local"\`) or AST pattern matching (\`mode: "structural"\` via ast-grep).

**HOW to use it.**

\`\`\`json
{ "name": "search", "arguments": { "mode": "local", "query": "createMainWindow", "glob": "src/**/*.ts" } }
\`\`\`

\`\`\`json
{ "name": "search", "arguments": { "mode": "structural", "language": "typescript", "pattern": "export function $NAME($$$) { $$$ }", "glob": "**/*.ts" } }
\`\`\`

**WHY it exists.** Offline research is faster, private, and grounded in your codebase.

**WHEN to trigger it.** Use \`local\` for strings/symbols; use \`structural\` for AST-shaped queries (function defs, class members, import shapes).`,
  schema: {
    type: 'function',
    function: {
      name: 'search',
      description: 'Local file grep or ast-grep structural search across the workspace.',
      parameters: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['local', 'structural'] },
          query: { type: 'string', description: 'Line grep needle (local) or fallback pattern (structural).' },
          pattern: { type: 'string', description: 'ast-grep pattern (structural mode).' },
          language: {
            type: 'string',
            description: 'Language for structural mode: typescript, javascript, tsx, html, css.'
          },
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
    if (a.mode !== 'local' && a.mode !== 'structural') {
      return fail(
        id,
        started,
        `Error: unknown search mode "${String(a.mode)}" — use "local" or "structural".`,
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

    if (a.mode === 'structural') {
      const patternText = (typeof a.pattern === 'string' && a.pattern.trim()) || a.query.trim();
      const language = typeof a.language === 'string' ? a.language.trim() : '';
      if (!language) {
        return fail(
          id,
          started,
          'Error: structural search requires `language` (e.g. typescript, javascript, tsx).',
          'missing language'
        );
      }
      try {
        const { matches, truncated } = await runStructuralSearch({
          workspacePath: ctx.workspacePath,
          rootAbs,
          patternText,
          language,
          ...(a.glob ? { glob: a.glob } : {}),
          max,
          signal: ctx.signal
        });
        if (ctx.signal.aborted) {
          return fail(id, started, 'Structural search aborted.', 'aborted');
        }
        return {
          id,
          name: 'search',
          ok: true,
          output:
            matches.length > 0
              ? `# Structural search (${language}) — ${matches.length} hits${truncated ? ' (truncated)' : ''}\n` +
                matches.map((m) => `${m.path}:${m.line}\t${m.preview}`).join('\n')
              : `# No structural matches for pattern.`,
          data: {
            tool: 'search',
            mode: 'structural',
            query: patternText,
            matches,
            truncated
          },
          durationMs: Date.now() - started
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return fail(id, started, `Structural search error: ${msg}`, msg);
      }
    }

    return runLocalSearch(id, started, a, rootAbs, ctx.workspacePath, max, ctx.signal);
  }
};

async function runLocalSearch(
  id: string,
  started: number,
  a: Partial<SearchArgs>,
  rootAbs: string,
  workspacePath: string,
  max: number,
  signal: AbortSignal
): Promise<ToolResult> {
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

  const re = buildLooseRegex(a.query!);
  const matches: SearchMatch[] = [];
  let aborted = false;
  for (const file of files) {
    if (signal.aborted) {
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
    const rel = workspaceRelative(workspacePath, file);
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
    output:
      matches.length > 0
        ? `# Local search for "${a.query}" — ${matches.length} hits${truncated ? ' (truncated)' : ''}\n` +
          matches.map((m) => `${m.path}:${m.line}\t${m.preview}`).join('\n')
        : `# No local matches for "${a.query}".`,
    data: {
      tool: 'search',
      mode: 'local',
      query: a.query!,
      matches,
      truncated
    },
    durationMs: Date.now() - started
  };
}

function buildLooseRegex(query: string): RegExp {
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escaped, 'i');
}

function fail(id: string, started: number, output: string, error: string): ToolResult {
  return { id, name: 'search', ok: false, output, error, durationMs: Date.now() - started };
}
