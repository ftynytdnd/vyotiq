/**
 * ast-grep `--debug-query` — pattern parse diagnostics (FAQ / zero-hit recovery).
 */

import type { CanonicalLang } from './languageMap.js';
import { toCliLangAlias } from './languageMap.js';
import { astGrepCliAvailable, runAstGrepCli } from './runCli.js';

const DEBUG_QUERY_MAX_CHARS = 4_096;

export async function runPatternDebugQuery(opts: {
  patternText: string;
  language: CanonicalLang;
  workspacePath: string;
  signal: AbortSignal;
}): Promise<string | null> {
  if (!astGrepCliAvailable()) return null;

  const result = await runAstGrepCli({
    args: [
      'run',
      '--pattern',
      opts.patternText,
      '--lang',
      toCliLangAlias(opts.language),
      '--debug-query=ast'
    ],
    cwd: opts.workspacePath,
    signal: opts.signal,
    timeoutMs: 15_000
  });

  const text = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join('\n');
  if (!text) return null;
  return text.length > DEBUG_QUERY_MAX_CHARS
    ? `${text.slice(0, DEBUG_QUERY_MAX_CHARS)}\n… (truncated)`
    : text;
}
