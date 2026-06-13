/**
 * Glob + ignore rules for workspace vector indexing (aligned with `search` tool).
 */

export const INDEXABLE_GLOB =
  '**/*.{ts,tsx,js,jsx,md,mdx,json,css,scss,html,py,go,rs,java,cpp,c,h,hpp,toml,yml,yaml}';

export const INDEXABLE_IGNORE = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/out/**',
  '**/.next/**',
  '**/.vyotiq/**'
];
