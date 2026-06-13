/**
 * Whether a workspace-relative path should open in the in-app editor
 * (vs attachment preview or OS default app).
 */

const EDITABLE_EXT =
  /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|py|rs|go|java|kt|kts|cs|cpp|cc|cxx|hpp|c|h|rb|php|swift|zig|lua|sql|sh|bash|zsh|toml|ini|env|vue|svelte|dart|ex|exs|hs|ml|fs|tf|hcl|dockerfile|makefile|txt|md|mdx|json|ya?ml|xml|html?|css|scss|less|log|csv)$/i;

export function isEditableTextFile(filePath: string): boolean {
  const base = filePath.split(/[/\\]/).pop() ?? '';
  if (base.length === 0) return false;
  if (base.toLowerCase() === 'dockerfile' || base.toLowerCase() === 'makefile') return true;
  return EDITABLE_EXT.test(base);
}
