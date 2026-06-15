/**
 * fast-glob ignore patterns shared by workspace tree listing and
 * folder attachment walks. Keep in sync with the attachment picker's
 * visibility contract — users should not attach from ignored trees.
 */
export const WORKSPACE_TREE_IGNORE = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/out/**',
  '**/.next/**'
] as const;

/** Single-segment names skipped by lazy `list-children` reads. */
export const WORKSPACE_TREE_IGNORED_NAMES = new Set([
  'node_modules',
  '.git',
  'dist',
  'out',
  '.next',
  '.vyotiq'
]);
