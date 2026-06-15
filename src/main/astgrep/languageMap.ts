/**
 * ast-grep language aliases, extension mapping, and napi/CLI resolution.
 */

import { Lang } from '@ast-grep/napi';

/** Canonical language ids (ast-grep CLI `language` field). */
export type CanonicalLang =
  | 'bash'
  | 'c'
  | 'cpp'
  | 'csharp'
  | 'css'
  | 'elixir'
  | 'go'
  | 'haskell'
  | 'hcl'
  | 'html'
  | 'java'
  | 'javascript'
  | 'json'
  | 'kotlin'
  | 'lua'
  | 'markdown'
  | 'nix'
  | 'php'
  | 'python'
  | 'ruby'
  | 'rust'
  | 'scala'
  | 'solidity'
  | 'swift'
  | 'typescript'
  | 'tsx'
  | 'yaml';

const ALIAS_TO_CANONICAL: Record<string, CanonicalLang> = {
  bash: 'bash',
  sh: 'bash',
  zsh: 'bash',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  'c++': 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  csharp: 'csharp',
  css: 'css',
  ex: 'elixir',
  elixir: 'elixir',
  exs: 'elixir',
  go: 'go',
  golang: 'go',
  hs: 'haskell',
  haskell: 'haskell',
  hcl: 'hcl',
  tf: 'hcl',
  html: 'html',
  htm: 'html',
  xhtml: 'html',
  java: 'java',
  js: 'javascript',
  javascript: 'javascript',
  jsx: 'javascript',
  cjs: 'javascript',
  mjs: 'javascript',
  json: 'json',
  kt: 'kotlin',
  kotlin: 'kotlin',
  kts: 'kotlin',
  lua: 'lua',
  nix: 'nix',
  php: 'php',
  py: 'python',
  python: 'python',
  py3: 'python',
  pyi: 'python',
  rb: 'ruby',
  ruby: 'ruby',
  rs: 'rust',
  rust: 'rust',
  scala: 'scala',
  sc: 'scala',
  sol: 'solidity',
  solidity: 'solidity',
  swift: 'swift',
  ts: 'typescript',
  typescript: 'typescript',
  cts: 'typescript',
  mts: 'typescript',
  tsx: 'tsx',
  yml: 'yaml',
  yaml: 'yaml',
  md: 'markdown',
  markdown: 'markdown'
};

/** File extension (no dot) → canonical language. */
export const EXTENSION_TO_LANG: Record<string, CanonicalLang> = {
  bash: 'bash',
  bats: 'bash',
  sh: 'bash',
  zsh: 'bash',
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  css: 'css',
  scss: 'css',
  ex: 'elixir',
  exs: 'elixir',
  go: 'go',
  hs: 'haskell',
  hcl: 'hcl',
  tf: 'hcl',
  html: 'html',
  htm: 'html',
  java: 'java',
  js: 'javascript',
  jsx: 'javascript',
  cjs: 'javascript',
  mjs: 'javascript',
  json: 'json',
  kt: 'kotlin',
  kts: 'kotlin',
  lua: 'lua',
  nix: 'nix',
  php: 'php',
  py: 'python',
  pyi: 'python',
  rb: 'ruby',
  rs: 'rust',
  scala: 'scala',
  sc: 'scala',
  sol: 'solidity',
  swift: 'swift',
  ts: 'typescript',
  cts: 'typescript',
  mts: 'typescript',
  tsx: 'tsx',
  yml: 'yaml',
  yaml: 'yaml',
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'markdown',
  toml: 'yaml'
};

const NAPI_CANONICAL = new Set<CanonicalLang>([
  'typescript',
  'javascript',
  'tsx',
  'html',
  'css'
]);

export function resolveCanonicalLang(input: string): CanonicalLang | null {
  const key = input.trim().toLowerCase();
  if (!key) return null;
  return ALIAS_TO_CANONICAL[key] ?? null;
}

export function extensionToLang(ext: string): CanonicalLang | null {
  const normalized = ext.replace(/^\./, '').toLowerCase();
  return EXTENSION_TO_LANG[normalized] ?? null;
}

export function langFromGlob(glob: string): CanonicalLang | null {
  const m = glob.match(/\.([a-zA-Z0-9]+)(?:\}|$|\*)/);
  if (!m?.[1]) return null;
  return extensionToLang(m[1]);
}

export function langFromPath(relPath: string): CanonicalLang | null {
  const base = relPath.split(/[/\\]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot < 0) return null;
  return extensionToLang(base.slice(dot + 1));
}

export function toNapiLang(canonical: CanonicalLang): Lang | null {
  if (!NAPI_CANONICAL.has(canonical)) return null;
  switch (canonical) {
    case 'typescript':
      return Lang.TypeScript;
    case 'javascript':
      return Lang.JavaScript;
    case 'tsx':
      return Lang.Tsx;
    case 'html':
      return Lang.Html;
    case 'css':
      return Lang.Css;
    default:
      return null;
  }
}

/** CLI `--lang` alias (short form where applicable). */
export function toCliLangAlias(canonical: CanonicalLang): string {
  switch (canonical) {
    case 'typescript':
      return 'ts';
    case 'javascript':
      return 'js';
    case 'python':
      return 'py';
    case 'csharp':
      return 'cs';
    case 'ruby':
      return 'rb';
    case 'rust':
      return 'rs';
    case 'yaml':
      return 'yml';
    case 'solidity':
      return 'sol';
    case 'kotlin':
      return 'kt';
    case 'markdown':
      return 'md';
    case 'elixir':
      return 'ex';
    case 'haskell':
      return 'hs';
    default:
      return canonical;
  }
}

export function napiSupports(canonical: CanonicalLang): boolean {
  return NAPI_CANONICAL.has(canonical);
}
