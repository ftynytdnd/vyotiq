/**
 * ast-grep structural search — AST pattern matching via @ast-grep/napi + CLI fallback.
 */

import { promises as fs } from 'node:fs';
import fg from 'fast-glob';
import { findInFiles, pattern, type Lang } from '@ast-grep/napi';
import type { SearchMatch } from '@shared/types/tool.js';
import { workspaceRelative } from '../tools/sandbox.js';
import type { CanonicalLang } from '../astgrep/languageMap.js';
import { napiSupports, toCliLangAlias, toNapiLang } from '../astgrep/languageMap.js';
import type { SearchMatcherKind } from '../astgrep/patterns.js';
import { escapeRustRegex } from '../astgrep/patterns.js';
import { runAstGrepCli } from '../astgrep/runCli.js';

const SEARCH_IGNORE = ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/out/**', '**/.next/**'];

const LANG_DEFAULT_GLOB: Partial<Record<CanonicalLang, string>> = {
  bash: '**/*.{sh,bash,zsh}',
  c: '**/*.{c,h}',
  cpp: '**/*.{cc,cpp,cxx,hpp,h}',
  csharp: '**/*.{cs}',
  css: '**/*.{css,scss}',
  go: '**/*.go',
  html: '**/*.{html,htm}',
  java: '**/*.java',
  javascript: '**/*.{js,jsx,cjs,mjs}',
  json: '**/*.json',
  kotlin: '**/*.{kt,kts}',
  markdown: '**/*.{md,mdx,markdown}',
  php: '**/*.php',
  python: '**/*.{py,pyi}',
  ruby: '**/*.{rb}',
  rust: '**/*.rs',
  swift: '**/*.swift',
  typescript: '**/*.{ts,cts,mts}',
  tsx: '**/*.{tsx}',
  yaml: '**/*.{yml,yaml}'
};

export interface StructuralSearchOpts {
  workspacePath: string;
  rootAbs: string;
  patternText: string;
  language: CanonicalLang;
  glob?: string;
  max: number;
  signal: AbortSignal;
  matcher?: SearchMatcherKind;
  /** Tree-sitter node kind or ESQuery-style selector (ast-grep 0.43+ `--kind`). */
  astKind?: string;
}

interface CliMatchLine {
  path?: string;
  file?: string;
  start?: { line?: number };
  lines?: string;
  text?: string;
}

function effectiveGlob(language: CanonicalLang, glob?: string): string {
  return glob ?? LANG_DEFAULT_GLOB[language] ?? '**/*';
}

function compileLineRegex(patternText: string): RegExp {
  try {
    return new RegExp(patternText, 'i');
  } catch {
    return new RegExp(escapeRustRegex(patternText), 'i');
  }
}

function pushMatch(
  matches: SearchMatch[],
  opts: StructuralSearchOpts,
  absFile: string,
  line: number,
  preview: string,
  matchedText?: string
): boolean {
  if (matches.length >= opts.max) return true;
  const rel = workspaceRelative(opts.workspacePath, absFile);
  matches.push({
    path: rel,
    line,
    preview: preview.replace(/\s+/g, ' ').trim().slice(0, 240),
    ...(matchedText ? { matchedText: matchedText.slice(0, 512) } : {})
  });
  return matches.length >= opts.max;
}

async function runLineRegexSearch(
  opts: StructuralSearchOpts
): Promise<{ matches: SearchMatch[]; truncated: boolean }> {
  const glob = effectiveGlob(opts.language, opts.glob);
  const re = compileLineRegex(opts.patternText);
  const matches: SearchMatch[] = [];
  let truncated = false;

  const files = await fg(glob, {
    cwd: opts.rootAbs,
    ignore: SEARCH_IGNORE,
    absolute: true,
    dot: false,
    onlyFiles: true,
    followSymbolicLinks: false
  });

  for (const file of files) {
    if (opts.signal.aborted) break;
    if (matches.length >= opts.max) {
      truncated = true;
      break;
    }
    let txt: string;
    try {
      txt = await fs.readFile(file, 'utf8');
    } catch {
      continue;
    }
    const lines = txt.split('\n');
    for (let i = 0; i < lines.length && matches.length < opts.max; i++) {
      if (opts.signal.aborted) break;
      const line = lines[i]!;
      if (!re.test(line)) continue;
      if (pushMatch(matches, opts, file, i + 1, line, line)) {
        truncated = true;
        break;
      }
    }
    if (truncated) break;
  }

  return { matches, truncated: truncated || matches.length >= opts.max };
}

async function runNapiSearch(
  opts: StructuralSearchOpts,
  napiLang: Lang
): Promise<{ matches: SearchMatch[]; truncated: boolean }> {
  const regexMode = opts.matcher === 'regex';
  const matches: SearchMatch[] = [];
  let truncated = false;

  const matcher = opts.astKind
    ? { rule: { kind: opts.astKind } }
    : regexMode
      ? { rule: { regex: opts.patternText } }
      : pattern(napiLang, opts.patternText);

  const glob = opts.glob ? { languageGlobs: [opts.glob] } : {};

  await findInFiles(
    napiLang,
    {
      paths: [opts.rootAbs],
      matcher,
      ...glob
    },
    (err, nodes) => {
      if (opts.signal.aborted) return;
      if (err) throw err;
      if (nodes.length === 0) return;

      const absFile = nodes[0]!.getRoot().filename();
      for (const node of nodes) {
        if (opts.signal.aborted) return;
        const range = node.range();
        const text = node.text();
        if (pushMatch(matches, opts, absFile, range.start.line + 1, text, text)) {
          truncated = true;
          return;
        }
      }
    }
  );

  return { matches, truncated: truncated || matches.length >= opts.max };
}

async function runCliAstSearch(
  opts: StructuralSearchOpts
): Promise<{ matches: SearchMatch[]; truncated: boolean }> {
  const matches: SearchMatch[] = [];
  const langAlias = toCliLangAlias(opts.language);
  const args = ['run', '--lang', langAlias, '--json=compact'];
  if (opts.astKind) {
    args.push('--kind', opts.astKind);
  } else {
    args.push('--pattern', opts.patternText);
  }
  const glob = effectiveGlob(opts.language, opts.glob);
  args.push('--globs', glob);
  args.push(opts.rootAbs);

  const result = await runAstGrepCli({
    args,
    cwd: opts.workspacePath,
    signal: opts.signal
  });

  if (opts.signal.aborted) {
    return { matches, truncated: false };
  }

  if (result.exitCode !== 0 && !result.stdout.trim()) {
    const detail = result.stderr.trim() || `ast-grep exited with code ${result.exitCode}`;
    throw new Error(detail);
  }

  let truncated = false;
  const lines = result.stdout.split('\n').filter((l) => l.trim());
  for (const line of lines) {
    if (opts.signal.aborted) break;
    let parsed: CliMatchLine;
    try {
      parsed = JSON.parse(line) as CliMatchLine;
    } catch {
      continue;
    }
    const absFile = parsed.path ?? parsed.file;
    if (!absFile) continue;
    const lineNo = (parsed.start?.line ?? 0) + 1;
    const text = parsed.text ?? parsed.lines ?? '';
    if (pushMatch(matches, opts, absFile, lineNo, text, text)) {
      truncated = true;
      break;
    }
  }

  return { matches, truncated: truncated || matches.length >= opts.max };
}

export async function runStructuralSearch(
  opts: StructuralSearchOpts
): Promise<{ matches: SearchMatch[]; truncated: boolean }> {
  if (opts.astKind) {
    const napiLang = toNapiLang(opts.language);
    if (napiLang && napiSupports(opts.language)) {
      return runNapiSearch(opts, napiLang);
    }
    return runCliAstSearch(opts);
  }

  if (opts.matcher === 'regex') {
    return runLineRegexSearch(opts);
  }

  const napiLang = toNapiLang(opts.language);
  if (napiLang && napiSupports(opts.language)) {
    return runNapiSearch(opts, napiLang);
  }
  return runCliAstSearch(opts);
}
