/**
 * ast-grep structural search — AST pattern matching via @ast-grep/napi.
 */

import { findInFiles, pattern, Lang } from '@ast-grep/napi';
import type { SearchMatch } from '@shared/types/tool.js';
import { workspaceRelative } from './sandbox.js';

const LANG_ALIASES: Record<string, Lang> = {
  typescript: Lang.TypeScript,
  ts: Lang.TypeScript,
  javascript: Lang.JavaScript,
  js: Lang.JavaScript,
  tsx: Lang.Tsx,
  jsx: Lang.Tsx,
  html: Lang.Html,
  css: Lang.Css
};

export function resolveStructuralLang(language: string): Lang | null {
  return LANG_ALIASES[language.trim().toLowerCase()] ?? null;
}

export async function runStructuralSearch(opts: {
  workspacePath: string;
  rootAbs: string;
  patternText: string;
  language: string;
  glob?: string;
  max: number;
  signal: AbortSignal;
}): Promise<{ matches: SearchMatch[]; truncated: boolean }> {
  const lang = resolveStructuralLang(opts.language);
  if (!lang) {
    throw new Error(
      `unsupported structural language "${opts.language}" — use typescript, javascript, tsx, html, or css`
    );
  }

  const matches: SearchMatch[] = [];
  let truncated = false;

  await findInFiles(
    lang,
    {
      paths: [opts.rootAbs],
      matcher: pattern(lang, opts.patternText),
      ...(opts.glob ? { languageGlobs: [opts.glob] } : {})
    },
    (err, nodes) => {
      if (opts.signal.aborted) return;
      if (err) throw err;
      if (nodes.length === 0) return;

      const absFile = nodes[0]!.getRoot().filename();
      const rel = workspaceRelative(opts.workspacePath, absFile);

      for (const node of nodes) {
        if (opts.signal.aborted) return;
        if (matches.length >= opts.max) {
          truncated = true;
          return;
        }
        const range = node.range();
        const preview = node.text().replace(/\s+/g, ' ').trim().slice(0, 240);
        matches.push({
          path: rel,
          line: range.start.line + 1,
          preview
        });
      }
    }
  );

  return { matches, truncated };
}
