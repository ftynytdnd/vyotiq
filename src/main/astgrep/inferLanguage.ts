/**
 * Infer ast-grep language from explicit arg, glob, path, or workspace markers.
 */

import { access } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type CanonicalLang,
  langFromGlob,
  langFromPath,
  resolveCanonicalLang
} from './languageMap.js';

export type LanguageInferenceSource = 'explicit' | 'glob' | 'path' | 'workspace' | 'default';

export interface InferredLanguage {
  lang: CanonicalLang;
  source: LanguageInferenceSource;
}

const WORKSPACE_MARKERS: ReadonlyArray<{ file: string; lang: CanonicalLang }> = [
  { file: 'tsconfig.json', lang: 'typescript' },
  { file: 'jsconfig.json', lang: 'javascript' },
  { file: 'Cargo.toml', lang: 'rust' },
  { file: 'go.mod', lang: 'go' },
  { file: 'pyproject.toml', lang: 'python' },
  { file: 'requirements.txt', lang: 'python' },
  { file: 'Gemfile', lang: 'ruby' },
  { file: 'build.gradle', lang: 'java' },
  { file: 'pom.xml', lang: 'java' }
];

async function fileExists(root: string, rel: string): Promise<boolean> {
  try {
    await access(join(root, rel));
    return true;
  } catch {
    return false;
  }
}

async function inferFromWorkspace(workspacePath: string): Promise<CanonicalLang | null> {
  for (const { file, lang } of WORKSPACE_MARKERS) {
    if (await fileExists(workspacePath, file)) return lang;
  }
  if (await fileExists(workspacePath, 'package.json')) return 'typescript';
  return null;
}

export async function inferLanguage(opts: {
  explicit?: string;
  glob?: string;
  path?: string;
  workspacePath: string;
}): Promise<InferredLanguage> {
  if (opts.explicit?.trim()) {
    const resolved = resolveCanonicalLang(opts.explicit);
    if (resolved) return { lang: resolved, source: 'explicit' };
    throw new Error(
      `unsupported language "${opts.explicit}" — see ast-grep language list (typescript, python, go, rust, …)`
    );
  }

  if (opts.glob?.trim()) {
    const fromGlob = langFromGlob(opts.glob);
    if (fromGlob) return { lang: fromGlob, source: 'glob' };
  }

  if (opts.path?.trim() && opts.path !== '.') {
    const fromPath = langFromPath(opts.path);
    if (fromPath) return { lang: fromPath, source: 'path' };
  }

  const fromWorkspace = await inferFromWorkspace(opts.workspacePath);
  if (fromWorkspace) return { lang: fromWorkspace, source: 'workspace' };

  return { lang: 'typescript', source: 'default' };
}
