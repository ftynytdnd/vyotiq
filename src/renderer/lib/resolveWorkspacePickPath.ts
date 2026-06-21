import {
  normalizeClipboardPath,
  normalizePathComparisonKey
} from '@shared/attachments/clipboardFilePaths.js';

/** Join a workspace-relative path to the active workspace root when needed. */
export function resolveWorkspacePickPath(path: string, workspaceRoot: string | null): string {
  if (!workspaceRoot) return path;
  if (/^[a-zA-Z]:[\\/]/.test(path) || path.startsWith('/')) return path;
  const sep = workspaceRoot.includes('\\') ? '\\' : '/';
  return `${workspaceRoot.replace(/[/\\]+$/, '')}${sep}${path.replace(/^[/\\]+/, '')}`;
}

function normalizePathSlashes(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '');
}

/**
 * Prefer workspace-relative paths for `attachments:ingest-paths` so main can
 * resolve via the workspace sandbox (shorter wire payloads, correct cwd).
 */
export function toAttachmentIngestPath(path: string, workspaceRoot: string | null): string {
  const trimmed = path.trim();
  if (!trimmed) return trimmed;
  if (!workspaceRoot) return trimmed;

  const decoded = /^file:/i.test(trimmed) ? normalizeClipboardPath(trimmed) : trimmed;
  const rootKey = normalizePathComparisonKey(workspaceRoot);
  const pathKey = normalizePathComparisonKey(decoded);

  if (pathKey === rootKey) return '.';
  const rootPrefix = `${rootKey}/`;
  if (pathKey.startsWith(rootPrefix)) {
    const rootNorm = normalizePathSlashes(workspaceRoot);
    const decodedNorm = normalizePathSlashes(decoded);
    return decodedNorm.slice(rootNorm.length + 1);
  }

  if (
    !/^[a-zA-Z]:[\\/]/.test(decoded) &&
    !decoded.startsWith('/') &&
    !decoded.startsWith('\\\\')
  ) {
    return decoded.replace(/^[/\\]+/, '');
  }

  return decoded;
}
