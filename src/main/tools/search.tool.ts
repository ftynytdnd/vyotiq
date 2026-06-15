/**
 * `search` tool — workspace AST search via ast-grep (default).
 */

import { randomUUID } from 'node:crypto';
import type { Tool } from './types.js';
import type { ToolResult } from '@shared/types/tool.js';
import { realpathInsideWorkspace } from './sandbox.js';
import { runStructuralSearch } from './structuralSearch.js';
import { runPatternDebugQuery } from '../astgrep/debugQuery.js';
import { inferLanguage } from '../astgrep/inferLanguage.js';
import { prepareSearchPattern, buildZeroHitHints } from '../astgrep/patterns.js';

interface SearchArgs {
  query?: string;
  path?: string;
  glob?: string;
  maxResults?: number;
  pattern?: string;
  language?: string;
  kind?: string;
}

export const searchTool: Tool = {
  name: 'search',
  briefMarkdown: `### Tool: \`search\`

**WHAT it is.** Workspace structural search via ast-grep — AST patterns, node \`kind\`, or auto regex fallback for grep-style queries.

**HOW to use it.**

\`\`\`json
{ "name": "search", "arguments": { "query": "createMainWindow", "glob": "src/**/*.ts" } }
\`\`\`

\`\`\`json
{ "name": "search", "arguments": { "pattern": "class $NAME", "glob": "tools/**/*.py", "language": "python" } }
\`\`\`

\`\`\`json
{ "name": "search", "arguments": { "kind": "function_declaration", "glob": "**/*.ts" } }
\`\`\`

**Rules.** Use \`$NAME\` / \`$$$\` metavariables — not grep regex (\`.*\`, \`|\`). \`language\` inferred from \`glob\`. Zero-hit AST searches include parse diagnostics.

**WHY it exists.** Offline, syntax-aware codebase research.

**WHEN to trigger it.** Locating symbols, defs, imports. Use \`read\` after hits. Rewrites / YAML rules → \`sg\`.`,
  schema: {
    type: 'function',
    function: {
      name: 'search',
      description: 'ast-grep structural (AST) search across the workspace.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search needle or AST pattern. Optional when `kind` is set.'
          },
          pattern: {
            type: 'string',
            description: 'Optional ast-grep pattern; defaults to query.'
          },
          kind: {
            type: 'string',
            description:
              'Tree-sitter node kind or ESQuery selector (e.g. function_declaration).'
          },
          language: {
            type: 'string',
            description: 'Optional language override. Inferred from glob/path when omitted.'
          },
          path: { type: 'string', description: 'Relative subpath to search.' },
          glob: { type: 'string', description: 'Glob filter (also used for language inference).' },
          maxResults: { type: 'number' }
        },
        required: []
      }
    }
  },
  async run(args, ctx): Promise<ToolResult> {
    const id = randomUUID();
    const started = Date.now();
    const a = args as Partial<SearchArgs>;

    const astKind = typeof a.kind === 'string' ? a.kind.trim() : '';
    const queryText = typeof a.query === 'string' ? a.query.trim() : '';
    const patternText = typeof a.pattern === 'string' ? a.pattern.trim() : '';

    if (!astKind && !queryText && !patternText) {
      return fail(id, started, 'Error: provide `query`, `pattern`, or `kind`.', 'missing query');
    }

    const max = typeof a.maxResults === 'number' ? Math.max(1, Math.min(200, a.maxResults)) : 50;
    const rawPattern = patternText || queryText || astKind;

    let rootAbs: string;
    try {
      rootAbs = await realpathInsideWorkspace(ctx.workspacePath, a.path ?? '.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return fail(id, started, `Sandbox error: ${msg}`, msg);
    }

    let inferred;
    try {
      inferred = await inferLanguage({
        ...(typeof a.language === 'string' ? { explicit: a.language } : {}),
        ...(a.glob ? { glob: a.glob } : {}),
        ...(a.path ? { path: a.path } : {}),
        workspacePath: ctx.workspacePath
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return fail(id, started, `Language error: ${msg}`, msg);
    }

    const prepared = astKind
      ? { patternText: astKind, matcher: 'ast' as const }
      : prepareSearchPattern(rawPattern, inferred.lang);

    try {
      const { matches, truncated } = await runStructuralSearch({
        workspacePath: ctx.workspacePath,
        rootAbs,
        patternText: prepared.patternText,
        language: inferred.lang,
        matcher: prepared.matcher,
        ...(astKind ? { astKind } : {}),
        ...(a.glob ? { glob: a.glob } : {}),
        max,
        signal: ctx.signal
      });
      if (ctx.signal.aborted) {
        return fail(id, started, 'Search aborted.', 'aborted');
      }

      const matcherLabel = astKind ? `kind:${astKind}` : prepared.matcher === 'regex' ? 'regex' : 'AST';
      const noteLine = prepared.autoNote ? `# ${prepared.autoNote}\n` : '';

      let debugQuery: string | null = null;
      if (matches.length === 0 && !astKind && prepared.matcher === 'ast') {
        debugQuery = await runPatternDebugQuery({
          patternText: prepared.patternText,
          language: inferred.lang,
          workspacePath: ctx.workspacePath,
          signal: ctx.signal
        });
      }

      const zeroHitHints =
        matches.length === 0
          ? buildZeroHitHints(prepared, inferred.lang, rawPattern, {
              ...(astKind ? { kindSearch: true } : {})
            })
          : '';
      const debugBlock = debugQuery ? `\n# Parse diagnostics:\n${debugQuery}` : '';

      return {
        id,
        name: 'search',
        ok: true,
        output:
          matches.length > 0
            ? `${noteLine}# ${matcherLabel} search (${inferred.lang}) — ${matches.length} hits${truncated ? ' (truncated)' : ''}\n` +
              matches.map((m) => `${m.path}:${m.line}\t${m.preview}`).join('\n')
            : `${noteLine}# No ${matcherLabel} matches.${zeroHitHints}${debugBlock}`,
        data: {
          tool: 'search',
          query: rawPattern,
          language: inferred.lang,
          inferenceSource: inferred.source,
          pattern: prepared.patternText,
          matcher: prepared.matcher,
          ...(astKind ? { kind: astKind } : {}),
          ...(prepared.autoNote ? { autoNote: prepared.autoNote } : {}),
          ...(zeroHitHints ? { zeroHitHints } : {}),
          ...(debugQuery ? { debugQuery } : {}),
          matches,
          truncated
        },
        durationMs: Date.now() - started
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      let debugQuery: string | null = null;
      if (!astKind && prepared.matcher === 'ast') {
        debugQuery = await runPatternDebugQuery({
          patternText: prepared.patternText,
          language: inferred.lang,
          workspacePath: ctx.workspacePath,
          signal: ctx.signal
        });
      }
      const debugBlock = debugQuery ? `\n# Parse diagnostics:\n${debugQuery}` : '';
      return fail(id, started, `Search error: ${msg}${debugBlock}`, msg);
    }
  }
};

function fail(id: string, started: number, output: string, error: string): ToolResult {
  return { id, name: 'search', ok: false, output, error, durationMs: Date.now() - started };
}
