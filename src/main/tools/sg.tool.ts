/**
 * `sg` tool — ast-grep CLI for run / scan / test (rewrite & rule workflows).
 */

import { randomUUID } from 'node:crypto';
import type { Tool } from './types.js';
import type { ToolResult } from '@shared/types/tool.js';
import { realpathInsideWorkspace } from './sandbox.js';
import { inferLanguage } from '../astgrep/inferLanguage.js';
import { toCliLangAlias } from '../astgrep/languageMap.js';
import { astGrepCliAvailable, runAstGrepCli } from '../astgrep/runCli.js';

type SgAction = 'run' | 'scan' | 'test';

interface SgArgs {
  action: SgAction;
  pattern?: string;
  rewrite?: string;
  language?: string;
  rulePath?: string;
  configPath?: string;
  path?: string;
  glob?: string;
  apply?: boolean;
}

export const sgTool: Tool = {
  name: 'sg',
  briefMarkdown: `### Tool: \`sg\`

**WHAT it is.** ast-grep CLI for structural **rewrite**, **scan** (YAML rules), and **test**.

**HOW to use it.**

\`\`\`json
{ "name": "sg", "arguments": { "action": "run", "pattern": "$A && $A()", "rewrite": "$A?.()", "language": "typescript", "path": "src" } }
\`\`\`

\`\`\`json
{ "name": "sg", "arguments": { "action": "scan", "rulePath": "rules/no-console.yml", "path": "src" } }
\`\`\`

\`\`\`json
{ "name": "sg", "arguments": { "action": "scan", "configPath": "sgconfig.yml" } }
\`\`\`

\`\`\`json
{ "name": "sg", "arguments": { "action": "test", "configPath": "sgconfig.yml" } }
\`\`\`

**WHY it exists.** Codemods and rule-driven refactors beyond \`search\`.

**WHEN to trigger it.** Rewrites, lint scans, rule tests. \`apply: true\` writes disk — confirm with user first.`,
  schema: {
    type: 'function',
    function: {
      name: 'sg',
      description: 'ast-grep CLI: run (search/rewrite), scan (YAML rules), or test rules.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['run', 'scan', 'test'] },
          pattern: { type: 'string', description: 'AST pattern (run action).' },
          rewrite: { type: 'string', description: 'Rewrite template (run action).' },
          language: { type: 'string', description: 'Language override for run.' },
          rulePath: {
            type: 'string',
            description: 'Workspace-relative YAML rule file (scan — single rule).'
          },
          configPath: {
            type: 'string',
            description: 'Workspace-relative sgconfig.yml (scan all rules / test suite).'
          },
          path: { type: 'string', description: 'Relative subpath (run/scan targets).' },
          glob: { type: 'string', description: 'Glob filter for run/scan.' },
          apply: {
            type: 'boolean',
            description: 'When true on run/scan, pass --update-all to write changes to disk.'
          }
        },
        required: ['action']
      }
    }
  },
  async run(args, ctx): Promise<ToolResult> {
    const id = randomUUID();
    const started = Date.now();
    const a = args as Partial<SgArgs>;

    if (!astGrepCliAvailable()) {
      return fail(
        id,
        started,
        'ast-grep CLI binary not available in this install.',
        'cli missing'
      );
    }

    if (a.action !== 'run' && a.action !== 'scan' && a.action !== 'test') {
      return fail(id, started, 'Error: `action` must be "run", "scan", or "test".', 'invalid action');
    }

    const cliArgs: string[] = [];

    if (a.action === 'run') {
      let targetAbs: string;
      try {
        targetAbs = await realpathInsideWorkspace(ctx.workspacePath, a.path ?? '.');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return fail(id, started, `Sandbox error: ${msg}`, msg);
      }

      const patternText = typeof a.pattern === 'string' ? a.pattern.trim() : '';
      if (!patternText) {
        return fail(id, started, 'Error: `pattern` is required for sg run.', 'missing pattern');
      }
      cliArgs.push('run', '--pattern', patternText, '--json=compact');
      if (typeof a.rewrite === 'string' && a.rewrite.trim()) {
        cliArgs.push('--rewrite', a.rewrite.trim());
      }
      try {
        const inferred = await inferLanguage({
          ...(typeof a.language === 'string' ? { explicit: a.language } : {}),
          ...(a.glob ? { glob: a.glob } : {}),
          ...(a.path ? { path: a.path } : {}),
          workspacePath: ctx.workspacePath
        });
        cliArgs.push('--lang', toCliLangAlias(inferred.lang));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return fail(id, started, `Language error: ${msg}`, msg);
      }
      if (a.glob?.trim()) {
        cliArgs.push('--globs', a.glob.trim());
      }
      if (a.apply === true) {
        cliArgs.push('--update-all');
      }
      cliArgs.push(targetAbs);
    } else if (a.action === 'scan') {
      const rulePath = typeof a.rulePath === 'string' ? a.rulePath.trim() : '';
      const configPath = typeof a.configPath === 'string' ? a.configPath.trim() : '';
      if (!rulePath && !configPath) {
        return fail(
          id,
          started,
          'Error: provide `rulePath` (single rule) or `configPath` (sgconfig.yml) for sg scan.',
          'missing rulePath or configPath'
        );
      }

      let targetAbs: string;
      try {
        targetAbs = await realpathInsideWorkspace(ctx.workspacePath, a.path ?? '.');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return fail(id, started, `Sandbox error: ${msg}`, msg);
      }

      cliArgs.push('scan');
      try {
        if (configPath) {
          const configAbs = await realpathInsideWorkspace(ctx.workspacePath, configPath);
          cliArgs.push('-c', configAbs);
        } else {
          const ruleAbs = await realpathInsideWorkspace(ctx.workspacePath, rulePath);
          cliArgs.push('-r', ruleAbs);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return fail(id, started, `Sandbox error: ${msg}`, msg);
      }
      if (a.glob?.trim()) {
        cliArgs.push('--globs', a.glob.trim());
      }
      if (a.apply === true) {
        cliArgs.push('--update-all');
      }
      cliArgs.push(targetAbs);
    } else {
      const configRel = typeof a.configPath === 'string' && a.configPath.trim()
        ? a.configPath.trim()
        : 'sgconfig.yml';
      let configAbs: string;
      try {
        configAbs = await realpathInsideWorkspace(ctx.workspacePath, configRel);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return fail(
          id,
          started,
          `Sandbox error: ${msg} — create a project with \`ast-grep new\` or pass \`configPath\`.`,
          msg
        );
      }
      cliArgs.push('test', '-c', configAbs);
    }

    try {
      const result = await runAstGrepCli({
        args: cliArgs,
        cwd: ctx.workspacePath,
        signal: ctx.signal
      });

      if (ctx.signal.aborted) {
        return fail(id, started, 'sg aborted.', 'aborted');
      }

      const ok = sgInvocationOk(a.action, result.exitCode, result.timedOut, result.stdout);
      const outputParts = [
        `# sg ${a.action}${a.apply ? ' (applied)' : ''}`,
        result.stdout.trim(),
        result.stderr.trim() ? `stderr:\n${result.stderr.trim()}` : ''
      ].filter(Boolean);

      return {
        id,
        name: 'sg',
        ok,
        output: outputParts.join('\n\n') || (ok ? '# sg completed.' : '# sg failed.'),
        ...(ok ? {} : { error: result.stderr.trim() || `exit ${result.exitCode}` }),
        data: {
          tool: 'sg',
          action: a.action,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          signal: result.signal,
          timedOut: result.timedOut,
          stdoutTruncated: result.stdoutTruncated,
          stderrTruncated: result.stderrTruncated
        },
        durationMs: Date.now() - started
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return fail(id, started, `sg error: ${msg}`, msg);
    }
  }
};

function fail(id: string, started: number, output: string, error: string): ToolResult {
  return { id, name: 'sg', ok: false, output, error, durationMs: Date.now() - started };
}

/** `run` exits 1 when no matches — still a successful invocation. `test` must exit 0. */
function sgInvocationOk(
  action: SgAction,
  exitCode: number | null,
  timedOut: boolean,
  stdout: string
): boolean {
  if (timedOut || exitCode === null) return false;
  if (action === 'test') return exitCode === 0;
  if (action === 'run') return exitCode === 0 || exitCode === 1;
  return exitCode === 0 || stdout.trim().length > 0;
}
