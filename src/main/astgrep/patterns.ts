/**
 * Pattern normalization for ast-grep search — bridges grep-style queries to AST or regex.
 */

import type { CanonicalLang } from './languageMap.js';

export type SearchMatcherKind = 'ast' | 'regex';

export interface PreparedSearchPattern {
  patternText: string;
  matcher: SearchMatcherKind;
  /** Shown in tool output when the host rewrote the query. */
  autoNote?: string;
}

/** Escape a string for use inside a Rust regex (ast-grep `regex` rule). */
export function escapeRustRegex(input: string): string {
  return input.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

const SIMPLE_IDENTIFIER_RE = /^[A-Za-z_$][\w$]*$/;
const DECORATOR_QUERY_RE = /^@[A-Za-z_][\w.]*$/;

/** Grep/PCRE-style syntax that is not valid as a lone AST pattern. */
export function looksLikeRegexQuery(query: string): boolean {
  if (query.includes('.*') || query.includes('.+') || query.includes('?.') || query.includes('|')) {
    return true;
  }
  if (/\\[dwsWSWnrt0-9()[\]{}]/.test(query)) return true;
  if (/[\^$]/.test(query) && /[.*+?|]/.test(query)) return true;
  if (/^\(.*\)[*+?]?$/.test(query)) return true;
  return false;
}

function identifierAstPattern(id: string, language: CanonicalLang): string | null {
  switch (language) {
    case 'typescript':
    case 'javascript':
    case 'tsx':
      return id;
    default:
      return null;
  }
}

/**
 * Prepare a user/model query for ast-grep execution.
 * Rewrites common misuse (regex, decorators, bare identifiers) before search.
 */
export function prepareSearchPattern(
  raw: string,
  language: CanonicalLang
): PreparedSearchPattern {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { patternText: trimmed, matcher: 'ast' };
  }

  if (trimmed.includes('$')) {
    return { patternText: trimmed, matcher: 'ast' };
  }

  if (looksLikeRegexQuery(trimmed)) {
    return {
      patternText: trimmed,
      matcher: 'regex',
      autoNote:
        'grep-style regex detected — use AST metavariables (e.g. `class $NAME`, `export function $NAME`) for structural queries'
    };
  }

  if (DECORATOR_QUERY_RE.test(trimmed)) {
    return {
      patternText: trimmed,
      matcher: 'regex',
      autoNote:
        `decorator text match for ${trimmed} — for decorated defs use AST pattern \`@$DEC\\n def $NAME($$$): $$$\` with \`language: "python"\``
    };
  }

  if (SIMPLE_IDENTIFIER_RE.test(trimmed)) {
    const ast = identifierAstPattern(trimmed, language);
    if (ast) {
      return {
        patternText: ast,
        matcher: 'ast',
        autoNote: `identifier "${trimmed}" expanded to AST pattern — narrow with \`glob\` or a more specific \`pattern\``
      };
    }
    return {
      patternText: `\\b${escapeRustRegex(trimmed)}\\b`,
      matcher: 'regex',
      autoNote: `identifier "${trimmed}" searched as word-boundary regex`
    };
  }

  return { patternText: trimmed, matcher: 'ast' };
}

/** Actionable hints when a search returns zero hits. */
export function buildZeroHitHints(
  prepared: PreparedSearchPattern,
  language: CanonicalLang,
  rawQuery: string,
  opts?: { kindSearch?: boolean }
): string {
  if (opts?.kindSearch) {
    return (
      '\n# Hints:\n' +
      [
        `- No nodes of kind "${rawQuery}" in ${language} — verify \`glob\` and kind name.`,
        '- Discover kinds via tree-sitter `node-types.json` for the grammar.'
      ].join('\n')
    );
  }

  const lines: string[] = [];

  if (prepared.matcher === 'regex') {
    if (DECORATOR_QUERY_RE.test(rawQuery.trim())) {
      lines.push(
        '- Decorator text may not match if spacing differs — try AST:',
        `  pattern: "@$DEC\\n def $NAME($$$): $$$", language: "python", glob: "**/*.py"`
      );
    } else if (looksLikeRegexQuery(rawQuery)) {
      lines.push(
        '- Grep regex rarely matches AST nodes — rewrite with metavariables, e.g.:',
        '  `class $NAME`, `export function $NAME($$$) { $$$ }`, `import $MOD from $$$`'
      );
    } else {
      lines.push(
        '- Word-boundary regex found no lines — check `glob`/`path`, spelling, or try an AST pattern with `pattern`.'
      );
    }
  } else {
    lines.push(
      `- No AST matches for ${language} — verify \`glob\` covers the right files.`,
      '- For a symbol name, pass it as `query` (auto word-regex) or use `class $NAME` / `def $NAME`.',
      '- For bulk rewrites use `sg` with `action:"run"` or `action:"scan"`.'
    );
  }

  return lines.length > 0 ? `\n# Hints:\n${lines.join('\n')}` : '';
}
