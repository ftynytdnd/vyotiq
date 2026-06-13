/**
 * Map a workspace-relative file path to a highlight.js language id.
 * Pure lookup — callers validate registration with hljs.
 */

const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  rs: 'rust',
  go: 'go',
  json: 'json',
  md: 'markdown',
  mdx: 'markdown',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  htm: 'html',
  xml: 'xml',
  svg: 'xml',
  sql: 'sql',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  vue: 'vue',
  svelte: 'svelte',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  c: 'c',
  h: 'c',
  cs: 'csharp',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  rb: 'ruby',
  php: 'php',
  swift: 'swift',
  zig: 'zig',
  lua: 'lua',
  r: 'r',
  dart: 'dart',
  ex: 'elixir',
  exs: 'elixir',
  hs: 'haskell',
  ml: 'ocaml',
  fs: 'fsharp',
  tf: 'hcl',
  hcl: 'hcl',
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  ini: 'ini',
  plist: 'xml'
};

export function languageFromPath(filePath: string): string | undefined {
  const base = filePath.split(/[/\\]/).pop() ?? '';
  if (!base.includes('.')) return undefined;
  const ext = base.split('.').pop()?.toLowerCase();
  if (!ext) return undefined;
  return EXT_TO_LANG[ext];
}

/** LSP `languageId` — defaults to plaintext when unknown. */
export function languageIdForPath(filePath: string): string {
  return languageFromPath(filePath) ?? 'plaintext';
}

export function basenameFromPath(filePath: string): string {
  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] || filePath;
}
