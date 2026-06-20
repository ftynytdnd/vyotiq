/** Join a workspace-relative path to the active workspace root when needed. */
export function resolveWorkspacePickPath(path: string, workspaceRoot: string | null): string {
  if (!workspaceRoot) return path;
  if (/^[a-zA-Z]:[\\/]/.test(path) || path.startsWith('/')) return path;
  const sep = workspaceRoot.includes('\\') ? '\\' : '/';
  return `${workspaceRoot.replace(/[/\\]+$/, '')}${sep}${path.replace(/^[/\\]+/, '')}`;
}
